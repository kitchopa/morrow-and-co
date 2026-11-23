import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';

const root=process.cwd();
const source=fs.readFileSync(path.join(root,'backend/worker.js'),'utf8').replace('export default {','globalThis.worker={');
const context={
  btoa:value=>Buffer.from(value,'utf8').toString('base64'),
  crypto:crypto.webcrypto,
  URL,
  Request,
  Response,
  TextEncoder,
  fetch:async(url,options={})=>{
    context.calls.push({url:String(url),options});
    if(String(url).endsWith('/v1/oauth2/token'))return new Response(JSON.stringify({access_token:'test-token'}),{status:200});
    if(String(url).includes('/v2/checkout/orders/')&&String(url).endsWith('/capture'))return new Response(JSON.stringify({id:String(url).split('/').at(-2),status:'COMPLETED',purchase_units:[{payments:{captures:[{id:'CAP-TEST-1',status:'COMPLETED',amount:{currency_code:'USD',value:'108.58'}}]}}]}),{status:200});
    if(String(url).endsWith('/v2/checkout/orders')){
      const id=`PAY-TEST-${context.createCount++}`;
      return new Response(JSON.stringify({id,status:'CREATED'}),{status:201});
    }
    if(String(url)==='https://api.resend.com/emails')return new Response(JSON.stringify({id:'email-test-1'}),{status:200});
    throw new Error(`Unexpected stub request: ${url}`);
  },
  calls:[],
  createCount:1,
  console
};
vm.runInNewContext(source,context);

class FakeKV{
  constructor(){this.values=new Map()}
  async get(key,type){const value=this.values.get(key);if(value===undefined)return null;return type==='json'?JSON.parse(value):value}
  async put(key,value){this.values.set(key,value)}
}
const env={PAYPAL_CLIENT_ID:'sandbox-client',PAYPAL_CLIENT_SECRET:'sandbox-secret',PAYPAL_API_BASE:'https://api-m.sandbox.paypal.com',ALLOWED_ORIGIN:'https://kitchopa.github.io',ORDERS:new FakeKV(),LIMITS:new FakeKV(),SHIPPING_AMOUNT:'0.00',TAX_AMOUNT:'0.00',RESEND_API_KEY:'resend-test',RESEND_FROM:'Morrow & Co. <support@example.com>',SUPPORT_EMAIL:'bahae6593@gmail.com'};
const request=(url,body,headers={})=>new Request(`https://worker.test${url}`,{method:body?'POST':'GET',headers:{origin:env.ALLOWED_ORIGIN,...headers},body:body?JSON.stringify(body):undefined});
const body=async response=>JSON.parse(await response.text());
const items=[{id:1,qty:2},{id:2,qty:1},{id:10,qty:3}];
const customer={firstName:'Test',lastName:'Buyer',email:'buyer@example.com',address:'1 Test Street',unit:'',city:'Casablanca',region:'Casablanca-Settat',postalCode:'20000',country:'MA'};

const createRequest=request('/api/orders',{items,customer},{'Idempotency-Key':'contract-test-key-123456'});
const created=await context.worker.fetch(createRequest,env);
assert.equal(created.status,200);
const createdBody=await body(created);
assert.equal(createdBody.totals.itemTotal,108.58);
assert.equal(createdBody.totals.total,108.58);
assert.equal(createdBody.internalOrderId.length,36);

const repeated=await context.worker.fetch(request('/api/orders',{items,customer},{'Idempotency-Key':'contract-test-key-123456'}),env);
assert.equal(repeated.status,200);
assert.deepEqual(await body(repeated),createdBody);
assert.equal(context.calls.filter(call=>call.url.endsWith('/v2/checkout/orders')).length,1);

const capturePath=`/api/orders/${createdBody.id}/capture`;
const captured=await context.worker.fetch(request(capturePath,{customer}),env);
assert.equal(captured.status,200);
const capturedBody=await body(captured);
assert.equal(capturedBody.status,'PAID');
assert.equal(capturedBody.lines.length,3);
assert.equal(capturedBody.captureId,'CAP-TEST-1');
const repeatedCapture=await context.worker.fetch(request(capturePath,{customer}),env);
assert.equal(repeatedCapture.status,200);
assert.deepEqual(await body(repeatedCapture),capturedBody);
assert.equal(context.calls.filter(call=>call.url.endsWith('/capture')).length,1);

const cancelledCreate=await context.worker.fetch(request('/api/orders',{items:[{id:4,qty:1}],customer},{'Idempotency-Key':'contract-cancel-key-123456'}),env);
const cancelledBody=await body(cancelledCreate);
const cancelled=await context.worker.fetch(request(`/api/orders/${cancelledBody.id}/cancel`,{}),env);
assert.equal(cancelled.status,200);
assert.equal((await body(cancelled)).status,'CANCELLED');
assert.equal((await env.ORDERS.get(`created:${cancelledBody.id}`,'json')).status,'CANCELLED');
const cancelledCapture=await context.worker.fetch(request(`/api/orders/${cancelledBody.id}/capture`,{customer}),env);
assert.equal(cancelledCapture.status,409);

const invalid=await context.worker.fetch(request('/api/orders',{items:[{id:999,qty:1}],customer},{'Idempotency-Key':'contract-invalid-key-123456'}),env);
assert.equal(invalid.status,400);
const forbidden=await context.worker.fetch(new Request('https://worker.test/api/health',{headers:{origin:'https://evil.example'}}),env);
assert.equal(forbidden.status,403);

const contact=await context.worker.fetch(request('/api/contact',{fullName:'Test Buyer',email:'buyer@example.com',orderNumber:'PAY-TEST-1',subject:'Product question',message:'Please confirm the material.'}),env);
assert.equal(contact.status,202);
assert.equal((await body(contact)).delivery,'accepted');

console.log(JSON.stringify({created:'VERIFIED_WITH_STUB',idempotentCreate:'VERIFIED_WITH_STUB',idempotentCapture:'VERIFIED_WITH_STUB',cancellation:'VERIFIED_WITH_STUB',invalidOrigin:'VERIFIED',invalidCart:'VERIFIED',contactDelivery:'ACCEPTED_BY_STUB'}));
