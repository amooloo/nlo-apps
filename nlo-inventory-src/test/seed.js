/* legacy-shaped data, as Inventory 3.0.1 wrote it, plus a little of the new shape */
(function () {
  const now = Date.now(), iso = d => new Date(now - d * 864e5).toISOString(), ymd = d => { const t = new Date(now - d * 864e5); return t.getFullYear() + '-' + String(t.getMonth() + 1).padStart(2, '0') + '-' + String(t.getDate()).padStart(2, '0'); };
  const items = {
    'ppe-1': { id: 'ppe-1', cat: 'ppe', name: 'Gloves Pulse Nitrile — SM', sku: '177102', qty: 14, min: 2, unit: 'box', sources: [{ vendor: 'SunSurgical', sku: '177102', price: 9.13, src: 'https://www.sunsurgical.com', lastDate: ymd(40) }], location: 'Sterilization closet', chk: iso(33), group: 'Gloves', note: '100/box', exp: '', baseUnitName: 'Glove', orderUnitName: 'Box', baseUnitsPerOrderUnit: 100 },
    'ppe-2': { id: 'ppe-2', cat: 'ppe', name: 'Gloves Pulse Nitrile — LG', sku: '177302', qty: 6, min: 2, unit: 'box', price: 9.13, src: 'https://www.sunsurgical.com', chk: iso(33), group: 'Gloves', exp: '' },
    'ppe-3': { id: 'ppe-3', cat: 'ppe', name: 'Gloves Nitrile Black — LG', qty: 3, min: 10, unit: 'box', buyUnit: 'case', perBuy: 10, sources: [{ vendor: 'SunSurgical', sku: '186300', price: 10, src: '' }], group: 'Gloves' },
    'adh-1': { id: 'adh-1', cat: 'bonding', name: 'Transbond XT Syringe', qty: 4, min: 3, unit: 'syringe', sources: [{ vendor: 'American Orthodontics', sku: '712-035', price: 41.5 }, { vendor: 'Henry Schein', sku: '1012345', price: 39.99 }], img: 'data:image/gif;base64,R0lGODlhAQABAAAAACw=' },
    'cs-9': { id: 'cs-9', cat: 'clinical-supplies', name: 'CaviWipes XL', qty: 2, unit: 'canister', sources: [{ vendor: 'SunSurgical', sku: '14-1150', price: 14.54 }], archived: true },
    'gone-1': { id: 'gone-1', cat: 'misc', name: 'Old thing', qty: 0, deleted: true, deletedAt: iso(100) }
  };
  const orders = {
    'abc123': { id: 'abc123', vendor: 'Henry Schein', items: [{ name: 'Transbond XT Syringe', sku: '1012345', unit: 'syringe', qty: 2, price: 39.99, itemId: 'adh-1' }, { name: 'Shipping box', qty: 1, price: 5, itemId: '' }], status: 'open', dateOrdered: ymd(5), expectedDelivery: '', note: '', orderedBy: 'Sarah B.', method: 'call', _selectedVendorId: 'Henry Schein', _itemIds: ['adh-1'] },
    'order-old1': { id: 'order-old1', vendor: 'SunSurgical', items: [{ name: 'Gloves Pulse Nitrile — SM', sku: '177102', unit: 'box', qty: 2, price: 9.13, itemId: 'ppe-1' }], status: 'open', dateOrdered: ymd(3), orderedBy: 'Gwen R.', method: 'online' },
    'order-r1': { id: 'order-r1', vendor: 'American Orthodontics', items: [{ name: 'Transbond XT Syringe', sku: '712-035', unit: 'syringe', qty: 3, price: 41.5, itemId: 'adh-1', lineTotal: 124.5 }], status: 'received', dateOrdered: ymd(20), dateReceived: iso(15), receivedBy: 'Kaylee D.', countUpdated: true, shipping: 12, orderedBy: 'Sarah B.', method: 'online', invoiceShipping: 12 }
  };
  const log = {
    'l1': { id: 'l1', type: 'receive', itemId: 'adh-1', itemName: 'Transbond XT Syringe', delta: 3, amount: 124.5, orderId: 'order-r1', note: 'Order received: American Orthodontics', date: iso(15) },
    'l2': { id: 'l2', type: 'shipping', amount: 12, orderId: 'order-r1', note: 'Shipping: American Orthodontics', date: iso(15) },
    'l3': { id: 'l3', type: 'use', itemId: 'ppe-1', itemName: 'Gloves Pulse Nitrile — SM', delta: -1, note: 'Used 1', date: iso(2) },
    'l4': { id: 'l4', type: 'receive', itemId: 'ppe-2', itemName: 'Gloves Pulse Nitrile — LG', delta: 5, amount: null, note: 'Received', date: iso(40) }
  };
  const cart = [{ itemId: 'adh-1', name: 'Transbond XT Syringe', sku: '712-035', vendor: 'American Orthodontics', price: 41.5, unit: 'syringe', qty: 2 }];
  const roster = { people: {
    s_amir: { id: 's_amir', name: 'Dr. Amir Akhavan', short: 'Dr. A', title: 'Orthodontist / Owner' },
    s_sarah: { id: 's_sarah', name: 'Sarah Bell', short: 'Sarah B.', title: 'Office Coordinator' },
    s_gwen: { id: 's_gwen', name: 'Gwen Reed', short: 'Gwen R.', title: 'Clinical Assistant' },
    s_kaylee: { id: 's_kaylee', name: 'Kaylee Dunn', short: 'Kaylee D.', title: 'Clinical Assistant' },
    s_old: { id: 's_old', name: 'Past Person', short: 'Past P.', title: 'Assistant', active: false }
  } };
  window.__SEED = { nlo: { items, orders, log, cart, vendors: { sun: { id: 'sun', name: 'SunSurgical', acct: '12345' } }, budget: { monthly: 8000, categories: { 'infection-control': 1200 }, expenses: [{ id: 'x1', category: 'patient-care', amount: 145, note: 'Retainer cases', date: ymd(1) }], history: [] },
    elastoPrices: {}, bracketOrder: null, settings: { alertsOn: true, locations: ['Lab cabinet', 'Sterilization closet'] }, cadence: { roster } } };
})();
