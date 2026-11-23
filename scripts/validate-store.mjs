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
assert.match(read('app.js'),/data-buy-now/,'home page must expose Buy Now controls');
assert.match(read('app.js'),/function openSingleCheckout[\s\S]*addToCart[\s\S]*checkout\.html/,'Buy Now must merge into the cart and route to unified checkout');
assert.doesNotMatch(read('app.js'),/window\.location\.assign\(link\)/,'Buy Now must not bypass the unified cart with a legacy link');
assert.match(read('checkout.html'),/checkout\.js/,'checkout page must load checkout behavior');
assert.match(read('checkout.js'),/createOrder/,'checkout must implement PayPal createOrder path');
assert.match(read('checkout.js'),/enable-funding=card/,'checkout must request eligible PayPal card funding');
assert.match(read('backend/worker.js'),/v2\/checkout\/orders/,'backend must use PayPal Orders API');
assert.match(read('backend/worker.js'),/api\/contact/,'backend must expose the support endpoint');
assert.match(read('policies.html'),/contact-form/,'policies page must expose the support form');
assert.match(read('contact.js'),/bahae6593@gmail.com|supportEmail/,'support form must target the configured support destination');
assert.doesNotMatch(read('checkout-config.js'),/PAYPAL_CLIENT_SECRET|client_secret/i,'frontend config must not contain PayPal secrets');
assert.doesNotMatch(read('contact-config.js'),/RESEND_API_KEY|PAYPAL_CLIENT_SECRET|client_secret/i,'frontend contact config must not contain secrets');
console.log(JSON.stringify({products:products.length,paypalFallbacks:Object.keys(paypalLinks).length,assets:'16/16',checkout:'multi-item review implemented',backend:'server-side PayPal Orders/Capture scaffold'}));
