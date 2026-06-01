const fs = require('fs');
const path = require('path');

const FILE = path.join(__dirname, 'data.json');

function read() {
  if (!fs.existsSync(FILE)) return { purchases: [], tokens: [] };
  return JSON.parse(fs.readFileSync(FILE, 'utf8'));
}

function write(data) {
  fs.writeFileSync(FILE, JSON.stringify(data, null, 2));
}

module.exports = {
  insertPurchase: (p) => {
    const data = read();
    data.purchases.push({ id: data.purchases.length + 1, ...p });
    write(data);
    return true;
  },
  getPurchaseByOrderId: (orderId) => {
    const data = read();
    return data.purchases.find(x => x.order_id === orderId);
  },
  updatePurchaseByOrderId: (orderId, fields) => {
    const data = read();
    const idx = data.purchases.findIndex(x => x.order_id === orderId);
    if (idx === -1) return null;
    data.purchases[idx] = { ...data.purchases[idx], ...fields };
    write(data);
    return data.purchases[idx];
  },
  insertDownloadToken: (t) => {
    const data = read();
    data.tokens.push(t);
    write(data);
    return true;
  },
  getDownloadToken: (token) => {
    const data = read();
    return data.tokens.find(x => x.token === token);
  },
  markTokenUsed: (token) => {
    const data = read();
    const idx = data.tokens.findIndex(x => x.token === token);
    if (idx === -1) return null;
    data.tokens[idx].used = 1;
    write(data);
    return data.tokens[idx];
  }
};
