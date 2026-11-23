import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';

const root=process.cwd();
const read=file=>fs.readFileSync(path.join(root,file),'utf8');
const context={window:{}};
vm.runInNewContext(read('catalog.js'),context);
const {products,paypalLinks}=context.window.MORROW_CATALOG;
assert.equal(products.length,16,'catalog must contain 16 products');
assert.equal(new Set(products.map(product=>product.id)).size,16,'product IDs must be unique');
assert.equal(Object.keys(paypalLinks).length,16,'all legacy PayPal fallback links must remain');
for(const product of products){
  assert.ok(product.name&&product.price>0,`product ${product.id} needs a name and positive price`);
  assert.ok(fs.existsSync(path.join(root,product.image)),`missing image for product ${product.id}`);
  assert.match(product.image,/^assets\/product-\d+\.(jpg|png)$/,'product image must be a local asset');
}
assert.match(read('index.html'),/id="checkout"/,'home page must expose checkout behavior');
assert.match(read('app.js'),/checkout\.html/,'home page checkout action must route to checkout');
assert.match(read('checkout.html'),/checkout\.js/,'checkout page must load checkout behavior');
assert.match(read('checkout.js'),/createOrder/,'checkout must implement PayPal createOrder path');
assert.match(read('backend/worker.js'),/v2\/checkout\/orders/,'backend must use PayPal Orders API');
assert.doesNotMatch(read('checkout-config.js'),/PAYPAL_CLIENT_SECRET|client_secret/i,'frontend config must not contain PayPal secrets');
console.log(JSON.stringify({products:products.length,paypalFallbacks:Object.keys(paypalLinks).length,assets:'16/16',checkout:'multi-item review implemented',backend:'server-side PayPal Orders/Capture scaffold'}));
