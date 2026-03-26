const states = [
  { name: 'Abia', lat: 5.5134, lon: 7.5028 },
  { name: 'Adamawa', lat: 9.2035, lon: 12.4954 },
  { name: 'Akwa Ibom', lat: 5.0069, lon: 7.9034 },
  { name: 'Anambra', lat: 6.2105, lon: 7.0723 },
  { name: 'Bauchi', lat: 10.3142, lon: 9.8463 },
  { name: 'Bayelsa', lat: 4.9221, lon: 6.2624 },
  { name: 'Benue', lat: 7.7262, lon: 8.5369 },
  { name: 'Borno', lat: 11.8333, lon: 13.1500 },
  { name: 'Cross River', lat: 4.9829, lon: 8.3345 },
  { name: 'Delta', lat: 6.2100, lon: 6.7350 },
  { name: 'Ebonyi', lat: 6.3262, lon: 8.1062 },
  { name: 'Edo', lat: 6.3392, lon: 5.6174 },
  { name: 'Ekiti', lat: 7.6211, lon: 5.2214 },
  { name: 'Enugu', lat: 6.4599, lon: 7.5489 },
  { name: 'Gombe', lat: 10.2833, lon: 11.1667 },
  { name: 'Imo', lat: 5.4763, lon: 7.0258 },
  { name: 'Jigawa', lat: 11.6667, lon: 9.3333 },
  { name: 'Kaduna', lat: 10.6093, lon: 7.4295 },
  { name: 'Kano', lat: 12.0000, lon: 8.5167 },
  { name: 'Katsina', lat: 12.9855, lon: 7.6171 },
  { name: 'Kebbi', lat: 12.4661, lon: 4.1995 },
  { name: 'Kogi', lat: 7.8028, lon: 6.7333 },
  { name: 'Kwara', lat: 8.5000, lon: 4.5500 },
  { name: 'Lagos', lat: 6.6059, lon: 3.3491 },
  { name: 'Nasarawa', lat: 8.4388, lon: 8.2383 },
  { name: 'Niger', lat: 9.5835, lon: 6.5463 },
  { name: 'Ogun', lat: 7.1452, lon: 3.3277 },
  { name: 'Ondo', lat: 7.2508, lon: 5.2103 },
  { name: 'Osun', lat: 7.7667, lon: 4.5667 },
  { name: 'Oyo', lat: 7.3767, lon: 3.9398 },
  { name: 'Plateau', lat: 9.8965, lon: 8.8583 },
  { name: 'Rivers', lat: 4.8242, lon: 7.0336 },
  { name: 'Sokoto', lat: 13.0059, lon: 5.2475 },
  { name: 'Taraba', lat: 8.9056, lon: 11.3639 },
  { name: 'Yobe', lat: 11.7562, lon: 11.9575 },
  { name: 'Zamfara', lat: 12.1620, lon: 6.6630 },
  { name: 'Abuja', lat: 9.0723, lon: 7.4913 },
];

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

const BASE_PRICE = 2500;
const PER_KM_RATE = 15;

let sql = '-- Nationwide Interstate Pricing (Generated)\n';
sql += 'DELETE FROM state_pricing;\n\n';

for (let i = 0; i < states.length; i++) {
  for (let j = 0; j < states.length; j++) {
    if (i === j) continue;
    
    const s1 = states[i];
    const s2 = states[j];
    const distance = haversineKm(s1, s2);
    
    // Formula: Base + (Dist * Rate)
    // Round to nearest 500
    let price = BASE_PRICE + (distance * PER_KM_RATE);
    price = Math.round(price / 500) * 500;
    
    // Minimum price for interstate
    if (price < 3500) price = 3500;

    sql += `INSERT INTO state_pricing (origin_state, destination_state, price) VALUES ('${s1.name}', '${s2.name}', ${price});\n`;
  }
  sql += '\n';
}

console.log(sql);
