const {products}=window.MORROW_CATALOG;
const config=window.MORROW_CHECKOUT_CONFIG||{};
const root=document.querySelector('#checkout-root');
const money=value=>`$${Number(value).toFixed(2)}`;
const productById=id=>products.find(product=>product.id===Number(id));
const escapeHTML=value=>String(value??'').replace(/[&<>"']/g,character=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[character]));
let cart=readCart();
const checkoutSessionId=(()=>{
  try{
    const existing=sessionStorage.getItem('morrow-checkout-session');
    if(existing)return existing;
    const created=crypto.randomUUID?crypto.randomUUID():`${Date.now()}-${Math.random().toString(16).slice(2)}`;
    sessionStorage.setItem('morrow-checkout-session',created);
    return created;
  }catch{return `${Date.now()}-${Math.random().toString(16).slice(2)}`}
})();

function readCart(){
  try{
    const value=JSON.parse(localStorage.getItem('morrow-cart')||'[]');
    return Array.isArray(value)?value.filter(item=>productById(item.id)&&Number.isInteger(item.qty)&&item.qty>0).map(item=>({id:Number(item.id),qty:Math.min(99,item.qty)})):[];
  }catch{return []}
}
function saveCart(){localStorage.setItem('morrow-cart',JSON.stringify(cart))}
function subtotal(){return cart.reduce((sum,item)=>sum+productById(item.id).price*item.qty,0)}
function setQuantity(id,delta){
  const item=cart.find(entry=>entry.id===Number(id)); if(!item)return;
  item.qty=Math.max(0,Math.min(99,item.qty+Number(delta))); cart=cart.filter(entry=>entry.qty>0); saveCart(); render();
}
function itemMarkup(item){
  const product=productById(item.id);
  return `<div class="checkout-item"><img src="${escapeHTML(product.image)}" alt="${escapeHTML(product.name)}"><div><h3>${escapeHTML(product.name)}</h3><p>${money(product.price)} each · Quantity ${item.qty}</p><div class="checkout-qty"><button type="button" data-change="-1" data-item="${product.id}" aria-label="Decrease ${escapeHTML(product.name)}">−</button><span>${item.qty}</span><button type="button" data-change="1" data-item="${product.id}" aria-label="Increase ${escapeHTML(product.name)}">+</button><button type="button" class="text-button" data-remove="${product.id}">Remove</button></div></div><strong>${money(product.price*item.qty)}</strong></div>`;
}
function render(){
  if(!cart.length){root.innerHTML='<div class="empty-checkout"><h2>Your bag is empty.</h2><p>Add something considered before coming back here.</p><a class="button dark" href="index.html#shop">Browse the edit <span>↘</span></a></div>';return}
  root.innerHTML=`<div class="checkout-grid"><section class="checkout-section"><h2>Customer information</h2><form class="checkout-form" id="customer-form" novalidate><label>First name<input name="firstName" autocomplete="given-name" required></label><label>Last name<input name="lastName" autocomplete="family-name" required></label><label class="field-wide">Email<input type="email" name="email" autocomplete="email" required></label><label class="field-wide">Address<input name="address" autocomplete="street-address" required></label><label>Apartment or unit <span>(optional)</span><input name="unit" autocomplete="address-line2"></label><label>City<input name="city" autocomplete="address-level2" required></label><label>Region / state<input name="region" autocomplete="address-level1" required></label><label>Postal code<input name="postalCode" autocomplete="postal-code" required></label><label>Country<select name="country" autocomplete="country" required><option value="">Choose country</option><option value="MA">Morocco</option><option value="US">United States</option><option value="CA">Canada</option><option value="GB">United Kingdom</option><option value="FR">France</option><option value="ES">Spain</option><option value="DE">Germany</option><option value="OTHER">Other</option></select></label><p class="form-error" id="form-error" role="alert"></p></form></section><aside class="order-card"><h2>Your order</h2><div>${cart.map(itemMarkup).join('')}</div><div class="summary-line"><span>Subtotal</span><strong>${money(subtotal())}</strong></div><div class="summary-line"><span>Shipping</span><span>Shown before payment</span></div><div class="summary-line"><span>Taxes</span><span>Shown before payment</span></div><div class="summary-line summary-total"><span>Order subtotal</span><strong>${money(subtotal())}</strong></div><div class="payment-panel"><h3>Pay securely with PayPal</h3><p>One order will contain every item and quantity shown above. PayPal wallet and eligible debit or credit card options appear when enabled for this account.</p><div id="paypal-button-container" class="paypal-mount">${config.paypalClientId&&config.apiBase?'':'<div class="payment-blocked"><strong>Multi-item PayPal connection pending</strong>The cart and checkout review are live. A PayPal client ID and server endpoint still need to be added before this store can accept one secure multi-item payment.</div>'}</div></div><p class="checkout-note">Your card details are handled by PayPal. No payment is marked successful in this page; confirmation appears only after the backend verifies capture.</p></aside></div>`;
  bindCheckoutEvents();
  if(config.paypalClientId&&config.apiBase)loadPayPal();
}
function bindCheckoutEvents(){
  document.querySelectorAll('[data-change]').forEach(button=>button.addEventListener('click',()=>setQuantity(button.dataset.item,button.dataset.change)));
  document.querySelectorAll('[data-remove]').forEach(button=>button.addEventListener('click',()=>{cart=cart.filter(item=>item.id!==Number(button.dataset.remove));saveCart();render()}));
  document.querySelector('#customer-form')?.addEventListener('submit',event=>event.preventDefault());
}
function formData(){return Object.fromEntries(new FormData(document.querySelector('#customer-form')).entries())}
function validateForm(){
  const form=document.querySelector('#customer-form'); if(!form)return false;
  const error=document.querySelector('#form-error'); let valid=true;
  form.querySelectorAll('[required]').forEach(field=>{const okay=field.value.trim();field.setAttribute('aria-invalid',String(!okay));if(!okay)valid=false});
  const email=form.elements.email; if(email.value&&!/^\S+@\S+\.\S+$/.test(email.value)){email.setAttribute('aria-invalid','true');valid=false}
  error.textContent=valid?'':'Please complete the highlighted customer information before payment.';
  if(!valid)form.querySelector('[aria-invalid="true"]')?.focus(); return valid;
}
function apiUrl(path){return `${String(config.apiBase).replace(/\/$/,'')}${path}`}
function idempotencyKey(){return `${checkoutSessionId}:${cart.map(item=>`${item.id}x${item.qty}`).join(',')}:${String(document.querySelector('[name="email"]')?.value||'').trim().toLowerCase()}`}
function loadPayPal(){
  if(window.paypal){mountPayPal();return}
  const script=document.createElement('script');
  script.src=`https://www.paypal.com/sdk/js?client-id=${encodeURIComponent(config.paypalClientId)}&currency=${encodeURIComponent(config.currency||'USD')}&intent=capture&components=buttons&enable-funding=card`;
  script.onload=mountPayPal; script.onerror=()=>{document.querySelector('#paypal-button-container').innerHTML='<div class="payment-blocked"><strong>PayPal could not load</strong>Check the configured client ID and retry.</div>'}; document.head.appendChild(script);
}
function mountPayPal(){
  window.paypal.Buttons({
    style:{layout:'vertical',shape:'rect',label:'paypal',color:'gold'},
    onClick:()=>validateForm(),
    createOrder:async()=>{
      if(!validateForm())throw new Error('Customer information is incomplete');
      const response=await fetch(apiUrl('/api/orders'),{method:'POST',headers:{'Content-Type':'application/json','Idempotency-Key':idempotencyKey()},body:JSON.stringify({items:cart,customer:formData()})});
      if(!response.ok)throw new Error('Unable to create PayPal order');
      const data=await response.json(); if(!data.id)throw new Error('PayPal order ID missing'); return data.id;
    },
    onApprove:async(data)=>{
      const response=await fetch(apiUrl(`/api/orders/${encodeURIComponent(data.orderID)}/capture`),{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({customer:formData()})});
      const result=await response.json();
      if(!response.ok||result.status!=='COMPLETED')throw new Error('Payment was not verified as completed');
      showConfirmation(data.orderID,result);
    },
    onCancel:data=>{if(data?.orderID)fetch(apiUrl(`/api/orders/${encodeURIComponent(data.orderID)}/cancel`),{method:'POST'}).catch(()=>{});showCheckoutMessage('Payment was cancelled. Your bag is still saved.')},
    onError:error=>showCheckoutMessage(error?.message||'PayPal could not complete this payment. No success was recorded.')
  }).render('#paypal-button-container');
}
function showCheckoutMessage(message){const error=document.querySelector('#form-error');if(error)error.textContent=message}
function showConfirmation(orderID,result){
  const purchased=cart.map(item=>{const product=productById(item.id);return {product,quantity:item.qty,total:product.price*item.qty}});
  const customer=result.customer||formData();
  localStorage.removeItem('morrow-cart');
  root.innerHTML=`<section class="checkout-success"><p class="checkout-kicker">PAYMENT VERIFIED</p><h2>Thank you for your order.</h2><p>PayPal confirmed capture for order <strong>${escapeHTML(orderID)}</strong>. Keep this reference for your records.</p><div class="confirmation-grid"><div><h3>Purchased items</h3>${purchased.map(item=>`<div class="confirmation-item"><img src="${escapeHTML(item.product.image)}" alt="${escapeHTML(item.product.name)}"><span>${escapeHTML(item.product.name)} · Qty ${item.quantity}</span><strong>${money(item.total)}</strong></div>`).join('')}<div class="summary-line summary-total"><span>Total paid</span><strong>${money(result.totals?.total||subtotal())}</strong></div></div><div><h3>Shipping details</h3><p>${escapeHTML(customer.firstName)} ${escapeHTML(customer.lastName)}<br>${escapeHTML(customer.address)}${customer.unit?` · ${escapeHTML(customer.unit)}`:''}<br>${escapeHTML(customer.city)}, ${escapeHTML(customer.region)} ${escapeHTML(customer.postalCode)}<br>${escapeHTML(customer.country)}<br>${escapeHTML(customer.email)}</p></div></div><p class="checkout-note">The verified payment response was received from the backend. A separate email is sent only if an email service is configured.</p><a class="button dark" href="index.html#shop">Return to the edit <span>→</span></a></section>`;
}
render();
