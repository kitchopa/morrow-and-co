const CATALOG={
  1:{name:'Cloud Sleep Mask',price:'21.36'},2:{name:'Sip Everywhere Bottle',price:'28.48',sku:'CJJT192676801AZ'},3:{name:'Rise & Rest Light',price:'42.72'},4:{name:'The Tidy Tray',price:'24.92',sku:'CJYD232706101AZ'},5:{name:'Pocket Power Bank',price:'34.71',sku:'CJXFLPDC00067-White'},6:{name:'Pebble Massage Ball',price:'16.02'},7:{name:'Foldaway Market Tote',price:'19.58',sku:'CJNS148655201AZ'},8:{name:'Soft Focus Timer',price:'23.14',sku:'CJJT104845301AZ'},9:{name:'Sunday Stretch Strap',price:'16.91'},10:{name:'Cable Keepers',price:'12.46',sku:'CJYD197888515OL'},11:{name:'Cupholder Carry Mug',price:'25.81',sku:'CJHS115718201AZ'},12:{name:'Breathe Mini Fan',price:'22.25',sku:'CJJT177988401AZ'},13:{name:'Daily Notes Pad',price:'14.24',sku:'CJJSBGBG00125-White-B5'},14:{name:'Easy Pour Oil Bottle',price:'26.70',sku:'CJYD187611401AZ'},15:{name:'Calm Earplugs',price:'18.69'},16:{name:'Entryway Key Hook',price:'30.26',sku:'CJYD220248101AZ'}
};
const json=(body,status=200,origin='')=>new Response(JSON.stringify(body),{status,headers:{'content-type':'application/json; charset=utf-8','cache-control':'no-store','access-control-allow-origin':origin,'access-control-allow-credentials':'true','vary':'Origin'}});
const round=value=>Math.round((Number(value)+Number.EPSILON)*100)/100;
const amount=value=>round(value).toFixed(2);
function originFor(request,env){const origin=request.headers.get('Origin')||'';return origin&&origin===env.ALLOWED_ORIGIN?origin:env.ALLOWED_ORIGIN||''}
function validOrigin(request,env){const origin=request.headers.get('Origin');return !origin||origin===env.ALLOWED_ORIGIN}
function requireConfig(env){return ['PAYPAL_CLIENT_ID','PAYPAL_CLIENT_SECRET','ALLOWED_ORIGIN','ORDERS'].filter(key=>!env[key])}
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
    merged.set(id,(merged.get(id)||0)+quantity);
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
  return Object.fromEntries(keys.map(key=>[key,String(customer[key]||'').trim().slice(0,180)]));
}
async function paypalRequest(env,path,options={}){
  const token=await accessToken(env);
  const response=await fetch(`${env.PAYPAL_API_BASE||'https://api-m.sandbox.paypal.com'}${path}`,{...options,headers:{authorization:`Bearer ${token}`,'content-type':'application/json',...(options.headers||{})}});
  const data=await response.json().catch(()=>({}));
  if(!response.ok)throw new Error(data?.message||'PayPal request failed');
  return data;
}
async function createOrder(request,env,origin){
  const body=await request.json();
  const lines=normalizeItems(body.items); const totals=calculateTotals(lines,env);
  const paypalItems=lines.map(line=>({name:line.product.name,sku:line.product.sku||`MORROW-${line.id}`,unit_amount:{currency_code:'USD',value:line.product.price},quantity:String(line.quantity),category:'PHYSICAL_GOODS'}));
  const orderPayload={
    intent:'CAPTURE',
    purchase_units:[{reference_id:'morrow-cart',description:'Morrow & Co. order',amount:{currency_code:'USD',value:amount(totals.total),breakdown:{item_total:{currency_code:'USD',value:amount(totals.itemTotal)},shipping:{currency_code:'USD',value:amount(totals.shipping)},tax_total:{currency_code:'USD',value:amount(totals.tax)}}},items:paypalItems}],
    application_context:{user_action:'PAY_NOW',shipping_preference:'NO_SHIPPING'}
  };
  const order=await paypalRequest(env,'/v2/checkout/orders',{method:'POST',body:JSON.stringify(orderPayload)});
  await env.ORDERS.put(`created:${order.id}`,JSON.stringify({id:order.id,lines:lines.map(line=>({id:line.id,quantity:line.quantity})),totals,customer:customerData(body.customer),createdAt:new Date().toISOString()}),{expirationTtl:86400});
  return json({id:order.id,status:order.status,totals},200,origin);
}
async function captureOrder(orderId,request,env,origin){
  const record=await env.ORDERS.get(`created:${orderId}`,'json'); if(!record)return json({error:'Order was not created by this store'},404,origin);
  const existing=await env.ORDERS.get(`captured:${orderId}`,'json'); if(existing)return json(existing,200,origin);
  const result=await paypalRequest(env,`/v2/checkout/orders/${encodeURIComponent(orderId)}/capture`,{method:'POST',body:'{}'});
  if(result.status!=='COMPLETED')return json({status:result.status||'NOT_COMPLETED',error:'PayPal did not report a completed capture'},409,origin);
  const saved={status:'COMPLETED',orderId,totals:record.totals,customer:record.customer,capturedAt:new Date().toISOString()};
  await env.ORDERS.put(`captured:${orderId}`,JSON.stringify(saved),{expirationTtl:31536000});
  return json(saved,200,origin);
}
export default {async fetch(request,env){
  const origin=originFor(request,env);
  if(request.method==='OPTIONS')return new Response(null,{status:204,headers:{'access-control-allow-origin':origin,'access-control-allow-credentials':'true','access-control-allow-methods':'POST,GET,OPTIONS','access-control-allow-headers':'content-type','vary':'Origin'}});
  if(!validOrigin(request,env))return json({error:'Origin not allowed'},403,origin);
  const url=new URL(request.url);
  if(url.pathname==='/api/health'&&request.method==='GET')return json({ok:true,configured:requireConfig(env).length===0,missing:requireConfig(env)},200,origin);
  const missing=requireConfig(env); if(missing.length)return json({error:'Payment backend is not configured',missing},503,origin);
  try{
    if(url.pathname==='/api/orders'&&request.method==='POST')return await createOrder(request,env,origin);
    const match=url.pathname.match(/^\/api\/orders\/([^/]+)\/capture$/); if(match&&request.method==='POST')return await captureOrder(match[1],request,env,origin);
    return json({error:'Not found'},404,origin);
  }catch(error){return json({error:error.message||'Request failed'},400,origin)}
}};
