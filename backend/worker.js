const CATALOG={
  1:{name:'Cloud Sleep Mask',price:'21.36'},2:{name:'Sip Everywhere Bottle',price:'28.48',sku:'CJJT192676801AZ'},3:{name:'Rise & Rest Light',price:'42.72'},4:{name:'The Tidy Tray',price:'24.92',sku:'CJYD232706101AZ'},5:{name:'Pocket Power Bank',price:'34.71',sku:'CJXFLPDC00067-White'},6:{name:'Pebble Massage Ball',price:'16.02'},7:{name:'Foldaway Market Tote',price:'19.58',sku:'CJNS148655201AZ'},8:{name:'Soft Focus Timer',price:'23.14',sku:'CJJT104845301AZ'},9:{name:'Sunday Stretch Strap',price:'16.91'},10:{name:'Cable Keepers',price:'12.46',sku:'CJYD197888515OL'},11:{name:'Cupholder Carry Mug',price:'25.81',sku:'CJHS115718201AZ'},12:{name:'Breathe Mini Fan',price:'22.25',sku:'CJJT177988401AZ'},13:{name:'Daily Notes Pad',price:'14.24',sku:'CJJSBGBG00125-White-B5'},14:{name:'Easy Pour Oil Bottle',price:'26.70',sku:'CJYD187611401AZ'},15:{name:'Calm Earplugs',price:'18.69'},16:{name:'Entryway Key Hook',price:'30.26',sku:'CJYD220248101AZ'}
};
const json=(body,status=200,origin='')=>new Response(JSON.stringify(body),{status,headers:{'content-type':'application/json; charset=utf-8','cache-control':'no-store','access-control-allow-origin':origin,'access-control-allow-credentials':'true','vary':'Origin'}});
const round=value=>Math.round((Number(value)+Number.EPSILON)*100)/100;
const amount=value=>round(value).toFixed(2);
const text=value=>String(value??'').trim().slice(0,2000);
const escapeHTML=value=>text(value).replace(/[&<>"']/g,character=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[character]));
const validEmail=value=>/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(String(value||''));
function originFor(request,env){const origin=request.headers.get('Origin')||'';return origin&&origin===env.ALLOWED_ORIGIN?origin:env.ALLOWED_ORIGIN||''}
function validOrigin(request,env){const origin=request.headers.get('Origin');return !origin||origin===env.ALLOWED_ORIGIN}
function missingConfig(env,keys){return keys.filter(key=>!env[key])}
function paymentMissing(env){return missingConfig(env,['PAYPAL_CLIENT_ID','PAYPAL_CLIENT_SECRET','ALLOWED_ORIGIN','ORDERS','SHIPPING_AMOUNT','TAX_AMOUNT'])}
function contactMissing(env){return missingConfig(env,['RESEND_API_KEY','RESEND_FROM','SUPPORT_EMAIL','ALLOWED_ORIGIN','LIMITS'])}
async function fingerprint(value){const digest=await crypto.subtle.digest('SHA-256',new TextEncoder().encode(value));return [...new Uint8Array(digest)].map(byte=>byte.toString(16).padStart(2,'0')).join('')}
async function accessToken(env){
  const basic=btoa(`${env.PAYPAL_CLIENT_ID}:${env.PAYPAL_CLIENT_SECRET}`);
  const response=await fetch(`${env.PAYPAL_API_BASE||'https://api-m.sandbox.paypal.com'}/v1/oauth2/token`,{method:'POST',headers:{authorization:`Basic ${basic}`,'content-type':'application/x-www-form-urlencoded'},body:'grant_type=client_credentials'});
  if(!response.ok)throw new Error('PayPal authentication failed');
  return (await response.json()).access_token;
}
function normalizeItems(items){
  if(!Array.isArray(items)||!items.length||items.length>50)throw new Error('Cart must contain between 1 and 50 line items');
  const merged=new Map();
  for(const item of items){
    const id=Number(item.id),quantity=Number(item.qty),product=CATALOG[id];
    if(!product||!Number.isInteger(quantity)||quantity<1||quantity>99)throw new Error('Cart contains an invalid product or quantity');
    const mergedQuantity=(merged.get(id)||0)+quantity;
    if(mergedQuantity>99)throw new Error('Cart contains an invalid product quantity');
    merged.set(id,mergedQuantity);
  }
  return [...merged.entries()].map(([id,quantity])=>{const product=CATALOG[id];return {id,quantity,product,lineTotal:round(Number(product.price)*quantity)}});
}
function calculateTotals(lines,env){
  const itemTotal=round(lines.reduce((sum,line)=>sum+line.lineTotal,0));
  if(env.SHIPPING_AMOUNT===undefined||env.TAX_AMOUNT===undefined)throw new Error('Shipping and tax configuration is required before accepting payment');
  const shipping=round(Number(env.SHIPPING_AMOUNT)),tax=round(Number(env.TAX_AMOUNT));
  if(!Number.isFinite(shipping)||shipping<0||!Number.isFinite(tax)||tax<0)throw new Error('Shipping and tax configuration is invalid');
  return {itemTotal,shipping,tax,total:round(itemTotal+shipping+tax)};
}
function customerData(value){
  const customer=value&&typeof value==='object'?value:{};
  const keys=['firstName','lastName','email','address','unit','city','region','postalCode','country'];
  return Object.fromEntries(keys.map(key=>[key,text(customer[key])]));
}
async function paypalRequest(env,path,options={}){
  const token=await accessToken(env);
  const response=await fetch(`${env.PAYPAL_API_BASE||'https://api-m.sandbox.paypal.com'}${path}`,{...options,headers:{authorization:`Bearer ${token}`,'content-type':'application/json',...(options.headers||{})}});
  const data=await response.json().catch(()=>({}));
  if(!response.ok)throw new Error(data?.message||'PayPal request failed');
  return data;
}
async function sendEmail(env,{to,subject,replyTo,html}){
  if(!env.RESEND_API_KEY||!env.RESEND_FROM)return {status:'not_configured'};
  const response=await fetch('https://api.resend.com/emails',{method:'POST',headers:{authorization:`Bearer ${env.RESEND_API_KEY}`,'content-type':'application/json'},body:JSON.stringify({from:env.RESEND_FROM,to:[to],reply_to:replyTo,subject,html})});
  const data=await response.json().catch(()=>({}));
  if(!response.ok)throw new Error(data?.message||'Email provider rejected the request');
  return {status:'accepted',id:data.id||null};
}
async function rateLimit(env,request,email){
  const ip=request.headers.get('CF-Connecting-IP')||'unknown';
  const key=`contact:${await fingerprint(`${ip}:${email.toLowerCase()}`)}`;
  if(await env.LIMITS.get(key))return false;
  await env.LIMITS.put(key,'1',{expirationTtl:3600}); return true;
}
async function contactRequest(request,env,origin){
  const body=await request.json();
  if(text(body.website))return json({accepted:true},202,origin);
  const fullName=text(body.fullName),email=text(body.email),orderNumber=text(body.orderNumber),subject=text(body.subject),message=text(body.message);
  const subjects=['Product question','Order assistance','Shipping question','Returns and refunds','Supplier/product correction','Payment issue','Other'];
  if(!fullName||!validEmail(email)||!subjects.includes(subject)||!message)return json({error:'Full name, valid email, subject, and message are required'},400,origin);
  if(message.length<10)return json({error:'Please include a little more detail in your message'},400,origin);
  if(!(await rateLimit(env,request,email)))return json({error:'Please wait before sending another request'},429,origin);
  const submittedAt=new Date().toISOString();
  const html=`<h2>Morrow &amp; Co. support request</h2><p><strong>Name:</strong> ${escapeHTML(fullName)}</p><p><strong>Email:</strong> ${escapeHTML(email)}</p><p><strong>Order number:</strong> ${escapeHTML(orderNumber||'Not provided')}</p><p><strong>Subject:</strong> ${escapeHTML(subject)}</p><p><strong>Submitted:</strong> ${escapeHTML(submittedAt)}</p><p><strong>Message:</strong></p><p>${escapeHTML(message).replace(/\n/g,'<br>')}</p>`;
  const delivery=await sendEmail(env,{to:env.SUPPORT_EMAIL,subject:`Morrow support: ${subject}`,replyTo:email,html});
  return json({accepted:true,delivery:delivery.status,submittedAt},202,origin);
}
function orderLinesHTML(lines){return lines.map(line=>`<li>${escapeHTML(line.product.name)} — Qty ${line.quantity} × $${line.product.price} = $${amount(line.lineTotal)}</li>`).join('')}
function customerHTML(customer){return `${escapeHTML(customer.firstName)} ${escapeHTML(customer.lastName)}<br>${escapeHTML(customer.address)}${customer.unit?` · ${escapeHTML(customer.unit)}`:''}<br>${escapeHTML(customer.city)}, ${escapeHTML(customer.region)} ${escapeHTML(customer.postalCode)}<br>${escapeHTML(customer.country)}<br>${escapeHTML(customer.email)}`}
async function createOrder(request,env,origin){
  const body=await request.json(); const lines=normalizeItems(body.items); const totals=calculateTotals(lines,env); const customer=customerData(body.customer);
  const requiredCustomerFields=['firstName','lastName','address','city','region','postalCode','country'];
  if(requiredCustomerFields.some(key=>!customer[key])||!validEmail(customer.email))throw new Error('Complete customer information and a valid email are required');
  const paypalItems=lines.map(line=>({name:line.product.name,sku:line.product.sku||`MORROW-${line.id}`,unit_amount:{currency_code:'USD',value:line.product.price},quantity:String(line.quantity),category:'PHYSICAL_GOODS'}));
  const orderPayload={intent:'CAPTURE',purchase_units:[{reference_id:'morrow-cart',description:'Morrow & Co. order',amount:{currency_code:'USD',value:amount(totals.total),breakdown:{item_total:{currency_code:'USD',value:amount(totals.itemTotal)},shipping:{currency_code:'USD',value:amount(totals.shipping)},tax_total:{currency_code:'USD',value:amount(totals.tax)}}},items:paypalItems}],application_context:{user_action:'PAY_NOW',shipping_preference:'NO_SHIPPING'}};
  const order=await paypalRequest(env,'/v2/checkout/orders',{method:'POST',body:JSON.stringify(orderPayload)});
  await env.ORDERS.put(`created:${order.id}`,JSON.stringify({id:order.id,lines,totals,customer,createdAt:new Date().toISOString()}),{expirationTtl:86400});
  return json({id:order.id,status:order.status,totals},200,origin);
}
async function captureOrder(orderId,env,origin){
  const record=await env.ORDERS.get(`created:${orderId}`,'json'); if(!record)return json({error:'Order was not created by this store'},404,origin);
  const existing=await env.ORDERS.get(`captured:${orderId}`,'json'); if(existing)return json(existing,200,origin);
  const result=await paypalRequest(env,`/v2/checkout/orders/${encodeURIComponent(orderId)}/capture`,{method:'POST',body:'{}'});
  const capture=result.purchase_units?.[0]?.payments?.captures?.[0];
  const paidAmount=round(Number(capture?.amount?.value));
  if(result.id!==orderId||result.status!=='COMPLETED'||capture?.status!=='COMPLETED'||capture?.amount?.currency_code!=='USD'||paidAmount!==record.totals.total)return json({status:'NOT_VERIFIED',error:'PayPal capture did not match the expected completed USD amount'},409,origin);
  const saved={status:'PAID',orderId,captureId:capture.id,amount:paidAmount,currency:'USD',totals:record.totals,lines:record.lines.map(line=>({id:line.id,name:line.product.name,quantity:line.quantity,unitPrice:line.product.price,lineTotal:line.lineTotal})),customer:record.customer,capturedAt:new Date().toISOString(),notifications:{owner:'pending',customer:'pending'}};
  await env.ORDERS.put(`captured:${orderId}`,JSON.stringify(saved),{expirationTtl:31536000});
  const ownerHtml=`<h2>Morrow &amp; Co. paid order</h2><p><strong>Order:</strong> ${escapeHTML(orderId)}</p><p><strong>Capture:</strong> ${escapeHTML(capture.id)}</p><p><strong>Status:</strong> PAID</p><p><strong>Customer:</strong><br>${customerHTML(record.customer)}</p><h3>Items</h3><ul>${orderLinesHTML(record.lines)}</ul><p><strong>Shipping:</strong> $${amount(record.totals.shipping)}<br><strong>Tax:</strong> $${amount(record.totals.tax)}<br><strong>Total:</strong> $${amount(record.totals.total)}</p>`;
  const customerHtml=`<h2>Thank you for your Morrow &amp; Co. order</h2><p>Your payment for order <strong>${escapeHTML(orderId)}</strong> was verified as PAID.</p><ul>${orderLinesHTML(record.lines)}</ul><p><strong>Shipping:</strong> $${amount(record.totals.shipping)}<br><strong>Tax:</strong> $${amount(record.totals.tax)}<br><strong>Total:</strong> $${amount(record.totals.total)}</p><p>Shipping details:<br>${customerHTML(record.customer)}</p><p>Questions? Reply to this email or contact ${escapeHTML(env.SUPPORT_EMAIL)}.</p>`;
  try{saved.notifications.owner=(await sendEmail(env,{to:env.SUPPORT_EMAIL,subject:`Paid Morrow order ${orderId}`,replyTo:record.customer.email,html:ownerHtml})).status}catch{saved.notifications.owner='failed'}
  try{saved.notifications.customer=(await sendEmail(env,{to:record.customer.email,subject:`Morrow & Co. order ${orderId}`,replyTo:env.SUPPORT_EMAIL,html:customerHtml})).status}catch{saved.notifications.customer='failed'}
  await env.ORDERS.put(`captured:${orderId}`,JSON.stringify(saved),{expirationTtl:31536000});
  return json(saved,200,origin);
}
export default {async fetch(request,env){
  const origin=originFor(request,env);
  if(request.method==='OPTIONS')return new Response(null,{status:204,headers:{'access-control-allow-origin':origin,'access-control-allow-credentials':'true','access-control-allow-methods':'POST,GET,OPTIONS','access-control-allow-headers':'content-type','vary':'Origin'}});
  if(!validOrigin(request,env))return json({error:'Origin not allowed'},403,origin);
  const url=new URL(request.url);
  if(url.pathname==='/api/health'&&request.method==='GET')return json({ok:true,paymentConfigured:paymentMissing(env).length===0,contactConfigured:contactMissing(env).length===0,paymentMissing:paymentMissing(env),contactMissing:contactMissing(env)},200,origin);
  try{
    if(url.pathname==='/api/contact'&&request.method==='POST'){
      const missing=contactMissing(env); if(missing.length)return json({error:'Contact service is not configured',missing},503,origin);
      return await contactRequest(request,env,origin);
    }
    if(url.pathname==='/api/orders'&&request.method==='POST'){
      const missing=paymentMissing(env); if(missing.length)return json({error:'Payment backend is not configured',missing},503,origin);
      return await createOrder(request,env,origin);
    }
    const match=url.pathname.match(/^\/api\/orders\/([^/]+)\/capture$/);
    if(match&&request.method==='POST'){
      const missing=paymentMissing(env); if(missing.length)return json({error:'Payment backend is not configured',missing},503,origin);
      return await captureOrder(match[1],env,origin);
    }
    return json({error:'Not found'},404,origin);
  }catch(error){return json({error:error.message||'Request failed'},400,origin)}
}};
