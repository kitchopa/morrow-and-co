const {products,PAYPAL_LINKS}=window.MORROW_CATALOG;
const productById=id=>products.find(product=>product.id===Number(id));
const money=value=>`$${Number(value).toFixed(2)}`;
const escapeHTML=value=>String(value??'').replace(/[&<>"']/g,character=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[character]));
const placeholderImage=name=>`data:image/svg+xml;charset=UTF-8,${encodeURIComponent(`<svg xmlns="http://www.w3.org/2000/svg" width="900" height="900"><rect width="900" height="900" fill="#e7e4db"/><text x="450" y="430" text-anchor="middle" fill="#20241d" font-family="Arial" font-size="28">${name}</text><text x="450" y="475" text-anchor="middle" fill="#74766c" font-family="Arial" font-size="18">Image unavailable</text></svg>`)}`;
let filter='all';
let query='';
let sort='featured';
let cart=loadCart();
const grid=document.querySelector('#product-grid');

function loadCart(){
  try{
    const parsed=JSON.parse(localStorage.getItem('morrow-cart')||'[]');
    return Array.isArray(parsed)?parsed.filter(item=>productById(item.id)&&Number.isInteger(item.qty)&&item.qty>0).map(item=>({id:Number(item.id),qty:Math.min(item.qty,99)})):[];
  }catch{return []}
}
function saveCart(){localStorage.setItem('morrow-cart',JSON.stringify(cart))}
function cartCount(){return cart.reduce((total,item)=>total+item.qty,0)}
function cartSubtotal(){return cart.reduce((total,item)=>total+(productById(item.id).price*item.qty),0)}
function listProducts(){
  let list=products.filter(product=>filter==='all'||product.cat===filter);
  if(query)list=list.filter(product=>`${product.name} ${product.desc} ${product.cat}`.toLowerCase().includes(query));
  if(sort==='price-low')list.sort((a,b)=>a.price-b.price);
  if(sort==='price-high')list.sort((a,b)=>b.price-a.price);
  if(sort==='name')list.sort((a,b)=>a.name.localeCompare(b.name));
  return list;
}
function productCard(product){
  return `<article class="product"><div class="product-image" data-detail="${product.id}">${product.tag?`<span class="tag">${escapeHTML(product.tag)}</span>`:''}<img src="${escapeHTML(product.image)}" alt="${escapeHTML(product.name)}" loading="lazy"><button class="button dark quick-add" data-add="${product.id}">Add to bag <span>+</span></button></div><div class="product-info"><div><h3>${escapeHTML(product.name)}</h3><p>${escapeHTML(product.desc)}</p><button class="buy-now" data-buy-now="${product.id}">Buy now ↗</button></div><strong>${money(product.price)}</strong></div></article>`;
}
function renderProducts(){
  const list=listProducts();
  grid.innerHTML=list.length?list.map(productCard).join(''):'<p class="empty-state">No products matched that search.</p>';
}
function renderCart(){
  const count=cartCount();
  document.querySelector('#cart-count').textContent=count;
  document.querySelector('#drawer-count').textContent=`(${count})`;
  document.querySelector('#subtotal').textContent=money(cartSubtotal());
  document.querySelector('#cart-items').innerHTML=cart.length?cart.map(item=>{
    const product=productById(item.id);
    return `<div class="cart-item"><img src="${escapeHTML(product.image)}" alt="${escapeHTML(product.name)}" loading="lazy"><div class="cart-item-copy"><h3>${escapeHTML(product.name)}</h3><p>${money(product.price)} each · Line total ${money(product.price*item.qty)}</p><div class="cart-actions"><button data-qty="${product.id}" data-change="-1" aria-label="Decrease ${escapeHTML(product.name)} quantity">−</button><output aria-label="${escapeHTML(product.name)} quantity">${item.qty}</output><button data-qty="${product.id}" data-change="1" aria-label="Increase ${escapeHTML(product.name)} quantity">+</button><button data-remove="${product.id}">Remove</button></div></div><strong>${money(product.price*item.qty)}</strong></div>`;
  }).join(''):'<p class="empty-state">Your bag is waiting for something good.</p>';
  document.querySelector('#clear-cart').disabled=!cart.length;
  saveCart();
}
function addToCart(id,quantity=1){
  const product=productById(id); if(!product)return;
  const item=cart.find(entry=>entry.id===product.id);
  if(item)item.qty=Math.min(99,item.qty+Math.max(1,Number(quantity)||1));
  else cart.push({id:product.id,qty:Math.min(99,Math.max(1,Number(quantity)||1))});
  renderCart(); showToast(`${product.name} added to your bag`);
}
function changeQuantity(id,delta){
  const item=cart.find(entry=>entry.id===Number(id)); if(!item)return;
  item.qty=Math.max(0,Math.min(99,item.qty+Number(delta)));
  cart=cart.filter(entry=>entry.qty>0); renderCart();
}
function removeFromCart(id){cart=cart.filter(item=>item.id!==Number(id));renderCart()}
function toggleCart(open){
  document.querySelector('.cart-drawer').classList.toggle('open',open);
  document.querySelector('.overlay').classList.toggle('show',open);
  document.querySelector('.cart-drawer').setAttribute('aria-hidden',String(!open));
}
function showToast(message){
  const toast=document.querySelector('.toast'); toast.textContent=message; toast.classList.add('show');
  clearTimeout(showToast.timer); showToast.timer=setTimeout(()=>toast.classList.remove('show'),2600);
}
function openCheckout(){
  if(!cart.length){showToast('Your bag is empty.');return}
  window.location.assign('checkout.html');
}
function openSingleCheckout(id){
  const link=PAYPAL_LINKS[id];
  if(link){showToast('Opening PayPal fallback checkout…');window.location.assign(link)}
  else showToast('The PayPal fallback for this product is not configured.');
}
function showDetails(id){
  const product=productById(id); if(!product)return;
  const dialog=document.querySelector('#product-dialog');
  const features=product.features||[];
  const source=product.supplierUrl?`<p class="shipping-note">${escapeHTML(product.shippingNote||'Supplier listing reference recorded.')}</p><a class="text-link" href="${escapeHTML(product.supplierUrl)}" target="_blank" rel="noopener">View supplier listing ↗</a><small class="supplier-sku">SKU: ${escapeHTML(product.supplierSku||'not recorded')}</small>`:`<p class="shipping-note">${escapeHTML(product.imageNote||'Supplier match not verified.')}</p>`;
  const related=products.filter(item=>item.id!==product.id&&item.cat===product.cat).slice(0,3).map(item=>`<button class="related-card" data-detail="${item.id}"><img src="${escapeHTML(item.image)}" alt="${escapeHTML(item.name)}"><span>${escapeHTML(item.name)}</span></button>`).join('');
  document.querySelector('#product-detail').innerHTML=`<div class="detail-wrap"><button class="detail-image-button" data-expand-image="${escapeHTML(product.image)}" data-expand-alt="${escapeHTML(product.name)}"><img src="${escapeHTML(product.image)}" alt="${escapeHTML(product.name)}"><span>View larger</span></button><div class="detail-copy"><p class="eyebrow">${escapeHTML(product.cat.replace('-',' + '))}</p><h2>${escapeHTML(product.name)}</h2><div class="detail-price">${money(product.price)}</div><p>${escapeHTML(product.details||product.desc)}</p><ul>${features.map(feature=>`<li>${escapeHTML(feature)}</li>`).join('')}</ul>${source}<div class="detail-purchase"><label for="detail-qty">Quantity</label><div class="quantity-control"><button type="button" data-detail-qty="-1" aria-label="Decrease quantity">−</button><input id="detail-qty" inputmode="numeric" pattern="[0-9]*" value="1" min="1" max="99" aria-label="Quantity"><button type="button" data-detail-qty="1" aria-label="Increase quantity">+</button></div><button class="button dark" data-detail-add="${product.id}">Add to bag <span>+</span></button><button class="buy-now detail-buy" data-buy-now="${product.id}">Buy now ↗</button></div></div></div><div class="detail-trust"><span>Secure payment via PayPal</span><span>Shipping shown before payment</span></div>${related?`<div class="related"><p class="eyebrow">YOU MAY ALSO LIKE</p><div class="related-grid">${related}</div></div>`:''}`;
  if(dialog.showModal)dialog.showModal();else dialog.setAttribute('open','');
}
function openExpandedImage(src,alt){
  const dialog=document.querySelector('#image-dialog'); const image=document.querySelector('#expanded-image'); image.src=src; image.alt=alt; if(dialog.showModal)dialog.showModal();else dialog.setAttribute('open','');
}
function toggleMobileMenu(force){const menu=document.querySelector('#mobile-menu');const open=force===undefined?!menu.classList.contains('open'):force;menu.classList.toggle('open',open);menu.setAttribute('aria-hidden',String(!open));document.querySelector('#menu-toggle').setAttribute('aria-expanded',String(open));}

document.addEventListener('click',event=>{
  const target=event.target;
  const buyNow=target.closest('[data-buy-now]'); if(buyNow){openSingleCheckout(Number(buyNow.dataset.buyNow));return}
  const add=target.closest('[data-add]'); if(add){addToCart(Number(add.dataset.add));return}
  const detailAdd=target.closest('[data-detail-add]'); if(detailAdd){addToCart(Number(detailAdd.dataset.detailAdd),Number(document.querySelector('#detail-qty')?.value)||1);document.querySelector('#product-dialog').close();return}
  const detailQty=target.closest('[data-detail-qty]'); if(detailQty){const input=document.querySelector('#detail-qty');input.value=Math.max(1,Math.min(99,(Number(input.value)||1)+Number(detailQty.dataset.detailQty)));return}
  const detail=target.closest('[data-detail]'); if(detail&&!target.closest('button')){showDetails(detail.dataset.detail);return}
  const image=target.closest('[data-expand-image]'); if(image){openExpandedImage(image.dataset.expandImage,image.dataset.expandAlt);return}
  const qty=target.closest('[data-qty]'); if(qty){changeQuantity(qty.dataset.qty,qty.dataset.change);return}
  const remove=target.closest('[data-remove]'); if(remove){removeFromCart(remove.dataset.remove);return}
  if(target.closest('#clear-cart')){if(cart.length&&window.confirm('Clear every item from your bag?')){cart=[];renderCart();}return}
  if(target.closest('.cart-trigger')){toggleCart(true);return}
  if(target.closest('.close-cart,.overlay')){toggleCart(false);return}
  if(target.closest('.dialog-close')){target.closest('dialog')?.close();return}
  const filterButton=target.closest('[data-filter]'); if(filterButton){document.querySelector('.filters .active')?.classList.remove('active');filterButton.classList.add('active');filter=filterButton.dataset.filter;renderProducts();return}
  if(target.closest('#view-all')){filter='all';query='';document.querySelector('#search-input').value='';document.querySelector('.filters .active')?.classList.remove('active');document.querySelector('[data-filter="all"]').classList.add('active');renderProducts();document.querySelector('#shop').scrollIntoView();return}
  const mobileLink=target.closest('.mobile-menu a'); if(mobileLink)toggleMobileMenu(false);
});
document.querySelector('#search-input').addEventListener('input',event=>{query=event.target.value.trim().toLowerCase();renderProducts()});
document.querySelector('#sort-products').addEventListener('change',event=>{sort=event.target.value;renderProducts()});
document.querySelector('#checkout').addEventListener('click',openCheckout);
document.querySelector('#menu-toggle').addEventListener('click',()=>toggleMobileMenu());
document.addEventListener('error',event=>{const image=event.target;if(image.tagName==='IMG'&&!image.dataset.fallback){image.dataset.fallback='true';image.src=placeholderImage(image.alt||'Morrow & Co. product')}},true);
renderProducts();renderCart();
