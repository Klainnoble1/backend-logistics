const pool = require('../config/database');
const axios = require('axios');

// Calculate distance between two addresses using Google Maps API
async function calculateDistance(pickupAddress, deliveryAddress) {
  try {
    const apiKey = process.env.GOOGLE_MAPS_API_KEY;
    if (!apiKey) {
      console.warn('Google Maps API key not set, using default distance');
      return 10; // Default 10km
    }

    // Geocode addresses
    const pickupGeo = await axios.get(
      `https://maps.googleapis.com/maps/api/geocode/json?address=${encodeURIComponent(pickupAddress)}&key=${apiKey}`
    );

    const deliveryGeo = await axios.get(
      `https://maps.googleapis.com/maps/api/geocode/json?address=${encodeURIComponent(deliveryAddress)}&key=${apiKey}`
    );

    if (pickupGeo.data.status !== 'OK' || deliveryGeo.data.status !== 'OK') {
      console.warn('Geocoding failed, using default distance');
      return 10;
    }

    const pickupLat = pickupGeo.data.results[0].geometry.location.lat;
    const pickupLng = pickupGeo.data.results[0].geometry.location.lng;
    const deliveryLat = deliveryGeo.data.results[0].geometry.location.lat;
    const deliveryLng = deliveryGeo.data.results[0].geometry.location.lng;

    // Calculate distance using Haversine formula
    const R = 6371; // Earth's radius in km
    const dLat = (deliveryLat - pickupLat) * Math.PI / 180;
    const dLng = (deliveryLng - pickupLng) * Math.PI / 180;
    const a = Math.sin(dLat / 2) * Math.sin(dLat / 2) +
              Math.cos(pickupLat * Math.PI / 180) * Math.cos(deliveryLat * Math.PI / 180) *
              Math.sin(dLng / 2) * Math.sin(dLng / 2);
    const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
    const distance = R * c;

    return Math.round(distance * 10) / 10; // Round to 1 decimal
  } catch (error) {
    console.error('Distance calculation error:', error);
    return 10; // Default distance
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

    // Calculate distance
    const distance = await calculateDistance(pickupAddress, deliveryAddress);

    // Calculate base price
    let price = parseFloat(pricingRule.base_price);

    // Add distance-based pricing
    price += distance * parseFloat(pricingRule.price_per_km);

    // Add weight-based pricing
    price += weight * parseFloat(pricingRule.price_per_kg);

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
        weight: weight * parseFloat(pricingRule.price_per_kg),
        express: serviceType === 'express' ? parseFloat(pricingRule.express_surcharge) : 0,
        insurance: insurance ? parseFloat(pricingRule.insurance_fee) : 0
      }
    };
  } catch (error) {
    console.error('Price calculation error:', error);
    throw error;
  }
}

// Estimate delivery date
function estimateDeliveryDate(serviceType, distance) {
  const today = new Date();
  let daysToAdd = 3; // Default standard delivery

  if (serviceType === 'express') {
    daysToAdd = 1;
  } else {
    // Standard delivery: 1 day per 50km, minimum 2 days
    daysToAdd = Math.max(2, Math.ceil(distance / 50));
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


