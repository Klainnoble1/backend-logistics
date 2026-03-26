/**
 * Generates a random 8-digit numeric code for delivery verification.
 * @returns {string} 8-digit numeric string
 */
function generateDeliveryCode() {
  return Math.floor(10000000 + Math.random() * 90000000).toString();
}

module.exports = generateDeliveryCode;
