const pool = require('../config/database');
const axios = require('axios');

// Mapbox - better coverage in Nigeria. Token in MAPBOX_ACCESS_TOKEN.
const MAPBOX_BASE = 'https://api.mapbox.com/geocoding/v5/mapbox.places';

// Nominatim (OpenStreetMap) - fallback, no API key. Use 1 req/sec.
const NOMINATIM_BASE = 'https://nominatim.openstreetmap.org/search';
const USER_AGENT = 'OprimeLogistics/1.0 (contact@example.com)';

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/** Geocode one address via Mapbox (when token set) or Nominatim (fallback). Returns { lat, lon } or null. */
async function geocodeAddress(address) {
  const mapboxToken = process.env.MAPBOX_ACCESS_TOKEN;
  if (mapboxToken) {
    try {
      const url = `${MAPBOX_BASE}/${encodeURIComponent(address)}.json`;
      const res = await axios.get(url, {
        params: { access_token: mapboxToken, limit: 1, country: 'NG' },
        timeout: 10000,
      });
      if (res.data?.features?.length > 0) {
        const [lon, lat] = res.data.features[0].center;
        return { lat: parseFloat(lat), lon: parseFloat(lon) };
      }
    } catch (err) {
      console.warn('Mapbox geocode failed, falling back to Nominatim:', err.message);
    }
  }
  const res = await axios.get(NOMINATIM_BASE, {
    params: { q: address, format: 'json', limit: 1 },
    headers: { 'User-Agent': USER_AGENT },
    timeout: 10000,
  });
  if (!res.data || res.data.length === 0) return null;
  const first = res.data[0];
  return { lat: parseFloat(first.lat), lon: parseFloat(first.lon) };
}

/** Haversine distance in km (fallback when OSRM unavailable) */
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

/** OSRM public demo - road distance & duration. Coords: lon,lat. Returns { distanceKm, durationMinutes } or null */
const OSRM_BASE = 'https://router.project-osrm.org/route/v1/driving';

async function getRoadDistanceAndDuration(pickup, delivery) {
  try {
    const url = `${OSRM_BASE}/${pickup.lon},${pickup.lat};${delivery.lon},${delivery.lat}?overview=false`;
    const res = await axios.get(url, { timeout: 8000 });
    if (!res.data?.routes?.length) return null;
    const route = res.data.routes[0];
    const distanceKm = (route.distance || 0) / 1000;
    const durationMinutes = (route.duration || 0) / 60;
    return {
      distanceKm: Math.round(distanceKm * 10) / 10,
      durationMinutes: Math.round(durationMinutes),
    };
  } catch (err) {
    console.warn('OSRM route failed, using straight-line distance:', err.message);
    return null;
  }
}

/**
 * Calculate road distance (and duration) between two addresses.
 * Uses Nominatim (geocode) + OSRM (road route). Falls back to Haversine if OSRM fails.
 * Returns { distanceKm, durationMinutes } (durationMinutes may be null if fallback).
 */
async function calculateDistance(pickupAddress, deliveryAddress) {
  try {
    const pickup = await geocodeAddress(pickupAddress);
    if (!process.env.MAPBOX_ACCESS_TOKEN) await sleep(1100);
    const delivery = await geocodeAddress(deliveryAddress);

    if (!pickup || !delivery) {
      console.warn('Geocoding failed for one or both addresses, using default distance');
      return { distanceKm: 10, durationMinutes: null };
    }

    const road = await getRoadDistanceAndDuration(pickup, delivery);
    if (road) return { distanceKm: road.distanceKm, durationMinutes: road.durationMinutes };

    const fallbackKm = haversineKm(pickup, delivery);
    return { distanceKm: Math.round(fallbackKm * 10) / 10, durationMinutes: null };
  } catch (error) {
    console.error('Distance calculation error:', error.message);
    return { distanceKm: 10, durationMinutes: null };
  }
}

// Calculate parcel price
async function calculatePrice(pickupAddress, deliveryAddress, weight, serviceType, insurance) {
  try {
    // Get active pricing rule
    const result = await pool.query(
      'SELECT * FROM pricing_rules WHERE is_active = true ORDER BY created_at DESC LIMIT 1'
    );

    if (result.rows.length === 0) {
      throw new Error('No active pricing rule found');
    }

    const pricingRule = result.rows[0];

    // Calculate road distance (OSRM) or fallback to straight-line
    const { distanceKm, durationMinutes } = await calculateDistance(pickupAddress, deliveryAddress);
    const distance = distanceKm;

    // Calculate base price
    let price = parseFloat(pricingRule.base_price);

    // Distance-based: Naira per km (₦300/km)
    price += distance * parseFloat(pricingRule.price_per_km);

    // Weight: first 5 kg included, then ₦300 per kg after (configurable via weight_included_kg / price_per_kg)
    const includedKg = (pricingRule.weight_included_kg != null ? parseFloat(pricingRule.weight_included_kg) : 5);
    const perKgAfter = parseFloat(pricingRule.price_per_kg);
    const weightCharge = weight <= includedKg ? 0 : (weight - includedKg) * perKgAfter;
    price += weightCharge;

    // Add express surcharge
    if (serviceType === 'express') {
      price += parseFloat(pricingRule.express_surcharge);
    }

    // Add insurance fee
    if (insurance) {
      price += parseFloat(pricingRule.insurance_fee);
    }

    // Apply min/max constraints
    if (price < parseFloat(pricingRule.min_price)) {
      price = parseFloat(pricingRule.min_price);
    }
    if (pricingRule.max_price && price > parseFloat(pricingRule.max_price)) {
      price = parseFloat(pricingRule.max_price);
    }

    return {
      price: Math.round(price * 100) / 100, // Round to 2 decimals
      distance,
      breakdown: {
        base: parseFloat(pricingRule.base_price),
        distance: distance * parseFloat(pricingRule.price_per_km),
        weight: weightCharge,
        express: serviceType === 'express' ? parseFloat(pricingRule.express_surcharge) : 0,
        insurance: insurance ? parseFloat(pricingRule.insurance_fee) : 0
      }
    };
  } catch (error) {
    console.error('Price calculation error:', error);
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
  estimateDeliveryDate
};


