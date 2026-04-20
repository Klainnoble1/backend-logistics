const pool = require('../config/database');
const axios = require('axios');

// Google Maps APIs
const GOOGLE_GEOCODING_BASE = 'https://maps.googleapis.com/maps/api/geocode/json';
const GOOGLE_DISTANCE_MATRIX_BASE = 'https://maps.googleapis.com/maps/api/distancematrix/json';

// Nominatim (OpenStreetMap) - last-resort fallback if Google key not set
const NOMINATIM_BASE = 'https://nominatim.openstreetmap.org/search';
const USER_AGENT = 'OprimeLogistics/1.0 (contact@example.com)';

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/** Normalize state names for robust matching (e.g., "Lagos State" -> "lagos") */
function normalizeState(name) {
  if (!name) return null;
  let s = String(name).toLowerCase().trim();

  // Map common variants of Abuja/FCT first
  if (s.includes('federal capital territory') || s === 'fct' || s === 'abuja') {
    return 'abuja';
  }

  // Remove common suffixes
  s = s.replace(/\s+(state|province|region|territory)$/gi, '');

  return s.trim();
}

/**
 * Extract state name from Google Geocoding API address_components array.
 * Google returns administrative_area_level_1 as the state/region.
 */
function extractStateFromGoogleComponents(addressComponents) {
  if (!Array.isArray(addressComponents)) return null;
  const stateComponent = addressComponents.find(
    (c) => Array.isArray(c.types) && c.types.includes('administrative_area_level_1')
  );
  return stateComponent ? stateComponent.long_name : null;
}

/**
 * Geocode one address via Google Geocoding API (primary) or Nominatim (fallback).
 * Returns { lat, lon, state } or null.
 */
async function geocodeAddress(address) {
  const googleKey = process.env.GOOGLE_MAPS_API_KEY;

  if (googleKey && googleKey.trim()) {
    try {
      const res = await axios.get(GOOGLE_GEOCODING_BASE, {
        params: {
          address: `${address}, Nigeria`,
          key: googleKey,
          region: 'ng',
        },
        timeout: 10000,
      });

      if (res.data?.status === 'OK' && res.data.results?.length > 0) {
        const result = res.data.results[0];
        const { lat, lng } = result.geometry.location;
        const state = extractStateFromGoogleComponents(result.address_components);
        return { lat: parseFloat(lat), lon: parseFloat(lng), state };
      }

      console.warn(`[PriceCalculation] Google Geocoding returned status: ${res.data?.status} for address: ${address}`);
      if (res.data?.error_message) {
        console.warn(`[PriceCalculation] Google Error: ${res.data.error_message}`);
      }
    } catch (err) {
      console.warn('[PriceCalculation] Google Geocoding request failed:', err.message);
    }
  } else {
    console.warn('[PriceCalculation] GOOGLE_MAPS_API_KEY is missing in environment. Using Nominatim fallback.');
  }

  // Fallback: Nominatim (no API key required — rate limited to 1 req/sec)
  try {
    console.log('[PriceCalculation] Attempting Nominatim fallback for:', address);
    await sleep(1100);
    const res = await axios.get(NOMINATIM_BASE, {
      params: { q: address, format: 'json', limit: 1, addressdetails: 1 },
      headers: { 'User-Agent': USER_AGENT },
      timeout: 10000,
    });
    if (!res.data || res.data.length === 0) {
      console.warn('[PriceCalculation] Nominatim returned no results for:', address);
      return null;
    }
    const first = res.data[0];
    return {
      lat: parseFloat(first.lat),
      lon: parseFloat(first.lon),
      state: first.address?.state || first.address?.province || null,
    };
  } catch (err) {
    console.error(`[PriceCalculation] Nominatim geocoding failed (403 usually means blocked IP): ${err.message}`);
    return null;
  }
}

/** Haversine distance in km (last-resort fallback if all APIs fail) */
function haversineKm(p1, p2) {
  const R = 6371;
  const dLat = ((p2.lat - p1.lat) * Math.PI) / 180;
  const dLon = ((p2.lon - p1.lon) * Math.PI) / 180;
  const a =
    Math.sin(dLat / 2) * Math.sin(dLat / 2) +
    Math.cos((p1.lat * Math.PI) / 180) * Math.cos((p2.lat * Math.PI) / 180) * Math.sin(dLon / 2) * Math.sin(dLon / 2);
  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
  return R * c;
}

/**
 * Google Distance Matrix API - real road distance & drive duration.
 * Returns { distanceKm, durationMinutes } or null if unavailable.
 */
async function getRoadDistanceAndDuration(pickup, delivery) {
  const googleKey = process.env.GOOGLE_MAPS_API_KEY;

  if (googleKey && googleKey.trim()) {
    try {
      const res = await axios.get(GOOGLE_DISTANCE_MATRIX_BASE, {
        params: {
          origins: `${pickup.lat},${pickup.lon}`,
          destinations: `${delivery.lat},${delivery.lon}`,
          mode: 'driving',
          key: googleKey,
          region: 'ng',
        },
        timeout: 10000,
      });

      if (res.data?.status === 'REQUEST_DENIED') {
        console.warn(`[PriceCalculation] Google Distance Matrix Request Denied: ${res.data.error_message || 'Check API Key restrictions'}`);
        return null;
      }

      const element = res.data?.rows?.[0]?.elements?.[0];
      if (element?.status === 'OK') {
        const distanceKm = (element.distance?.value || 0) / 1000;
        const durationMinutes = (element.duration?.value || 0) / 60;
        return {
          distanceKm: Math.round(distanceKm * 10) / 10,
          durationMinutes: Math.round(durationMinutes),
        };
      }

      console.warn(`[PriceCalculation] Google Distance Matrix returned element status: ${element?.status}`);
    } catch (err) {
      console.warn('[PriceCalculation] Google Distance Matrix request failed:', err.message);
    }
  } else {
    console.warn('[PriceCalculation] GOOGLE_MAPS_API_KEY is missing. Skipping Distance Matrix.');
  }

  return null;
}

/**
 * Calculate road distance (and duration) between two addresses.
 * Uses Google Geocoding API + Google Distance Matrix API.
 * Falls back to Nominatim geocoding + Haversine if Google key not configured.
 * Returns { distanceKm, durationMinutes, pickupState, deliveryState }.
 */
async function calculateDistance(pickupAddress, deliveryAddress) {
  try {
    const pickup = await geocodeAddress(pickupAddress);
    const delivery = await geocodeAddress(deliveryAddress);

    if (!pickup || !delivery) {
      const failed = !pickup ? 'pickup' : (!delivery ? 'delivery' : 'both');
      console.warn(`Geocoding failed for ${failed} address. Check GOOGLE_MAPS_API_KEY or verify the address is valid.`);
      // Default to 5km if geocoding fails to be slightly more realistic for intra-city
      return { distanceKm: 5, durationMinutes: null, pickupState: null, deliveryState: null };
    }

    const road = await getRoadDistanceAndDuration(pickup, delivery);
    if (road) {
      console.log('[PriceCalculation] Road distance result:', road);
      return { ...road, pickupState: pickup.state, deliveryState: delivery.state };
    }

    const fallbackKm = haversineKm(pickup, delivery);
    console.log('[PriceCalculation] Falling back to Haversine distance:', fallbackKm);
    return { 
      distanceKm: Math.round(fallbackKm * 10) / 10, 
      durationMinutes: null,
      pickupState: pickup.state,
      deliveryState: delivery.state
    };
  } catch (error) {
    console.error('CRITICAL Distance calculation error:', {
      message: error.message,
      pickupAddress,
      deliveryAddress,
      stack: error.stack
    });
    // Return a very specific number to make it obvious it's a hard fallback
    return { distanceKm: 10.01, durationMinutes: null, pickupState: null, deliveryState: null };
  }
}

// Calculate parcel price
async function calculatePrice(pickupAddress, deliveryAddress, weight, serviceType, insurance) {
  try {
    const result = await pool.query(
      'SELECT * FROM pricing_rules WHERE is_active = true ORDER BY created_at DESC LIMIT 1'
    );

    if (result.rows.length === 0) {
      throw new Error('No active pricing rule found');
    }

    const pricingRule = result.rows[0];
    console.log('[PriceCalculation] Using pricing rule:', {
      rule_name: pricingRule.rule_name,
      base_price: pricingRule.base_price,
      price_per_km: pricingRule.price_per_km,
      min_price: pricingRule.min_price
    });

    const { distanceKm, pickupState, deliveryState } = await calculateDistance(pickupAddress, deliveryAddress);
    const distance = distanceKm;
    console.log('[PriceCalculation] Distance calculated:', { distance, pickupState, deliveryState });

    let price = 0;
    const breakdown = {};

    // Check if Interstate
    const isInterstate = pickupState && deliveryState && normalizeState(pickupState) !== normalizeState(deliveryState);
    let interstateBasePrice = null;

    if (isInterstate) {
      const normPickup = normalizeState(pickupState);
      const normDelivery = normalizeState(deliveryState);
      
      // Find fixed interstate rate - try exact match first, then normalized
      const interstateResult = await pool.query(
        `SELECT price FROM state_pricing 
         WHERE (origin_state = $1 OR LOWER(origin_state) = $2)
           AND (destination_state = $3 OR LOWER(destination_state) = $4)
           AND is_active = true`,
        [pickupState, normPickup, deliveryState, normDelivery]
      );
      
      if (interstateResult.rows.length > 0) {
        interstateBasePrice = parseFloat(interstateResult.rows[0].price);
      }
    }

    if (isInterstate && interstateBasePrice !== null) {
      // Interstate Formula: Pickup Intra + Interstate Travel + Delivery Intra
      const pickupFee = parseFloat(pricingRule.intra_state_pickup_fee || 0);
      const deliveryFee = parseFloat(pricingRule.intra_state_delivery_fee || 0);
      
      price = pickupFee + interstateBasePrice + deliveryFee;
      
      breakdown.interstate_base = interstateBasePrice;
      breakdown.intra_state_pickup = pickupFee;
      breakdown.intra_state_delivery = deliveryFee;
    } else {
      // Intra-state / Distance-based Formula
      price = parseFloat(pricingRule.base_price);
      price += distance * parseFloat(pricingRule.price_per_km);
      
      breakdown.base = parseFloat(pricingRule.base_price);
      breakdown.distance = distance * parseFloat(pricingRule.price_per_km);
    }

    // Weight charge (applies to both if enabled)
    const includedKg = (pricingRule.weight_included_kg != null ? parseFloat(pricingRule.weight_included_kg) : 5);
    const perKgAfter = parseFloat(pricingRule.price_per_kg);
    const weightCharge = weight <= includedKg ? 0 : (weight - includedKg) * perKgAfter;
    price += weightCharge;
    breakdown.weight = weightCharge;

    // Surcharges
    if (serviceType === 'express') {
      const expressFee = parseFloat(pricingRule.express_surcharge);
      price += expressFee;
      breakdown.express = expressFee;
    }

    if (insurance) {
      const insuranceFee = parseFloat(pricingRule.insurance_fee);
      price += insuranceFee;
      breakdown.insurance = insuranceFee;
    }

    // Constraints
    if (price < parseFloat(pricingRule.min_price)) {
      console.log(`[PriceCalculation] Price ${price} is below min_price ${pricingRule.min_price}, adjusting.`);
      price = parseFloat(pricingRule.min_price);
    }
    if (pricingRule.max_price && price > parseFloat(pricingRule.max_price)) {
      console.log(`[PriceCalculation] Price ${price} is above max_price ${pricingRule.max_price}, adjusting.`);
      price = parseFloat(pricingRule.max_price);
    }

    console.log('[PriceCalculation] Final price:', price, 'Breakdown:', breakdown);

    return {
      price: Math.round(price * 100) / 100,
      distance,
      pickupState,
      deliveryState,
      breakdown
    };
  } catch (error) {
    console.error('CRITICAL Price calculation error:', {
      message: error.message,
      pickupAddress,
      deliveryAddress,
      weight,
      serviceType,
      stack: error.stack
    });
    throw error;
  }
}

// Estimate delivery date (distance in km; durationMinutes optional from OSRM)
function estimateDeliveryDate(serviceType, distance, durationMinutes = null) {
  const today = new Date();
  let daysToAdd;

  if (serviceType === 'express') {
    daysToAdd = durationMinutes != null ? Math.max(1, Math.ceil(durationMinutes / (8 * 60))) : 1;
  } else {
    if (durationMinutes != null) {
      daysToAdd = Math.max(2, Math.ceil(durationMinutes / (8 * 60)));
    } else {
      daysToAdd = Math.max(2, Math.ceil(distance / 50));
    }
  }

  const deliveryDate = new Date(today);
  deliveryDate.setDate(today.getDate() + daysToAdd);
  return deliveryDate.toISOString().split('T')[0];
}

module.exports = {
  calculatePrice,
  calculateDistance,
  estimateDeliveryDate,
  normalizeState
};


