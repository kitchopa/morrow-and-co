import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';

const root=process.cwd();
const source=fs.readFileSync(path.join(root,'backend/worker.js'),'utf8').replace('export default {','globalThis.worker={');

class FakeKV{
  constructor(){this.values=new Map()}
  async get(key,type){const value=this.values.get(key);if(value===undefined)return null;return type==='json'?JSON.parse(value):value}
  async put(key,value){this.values.set(key,value)}
}

function harness(){
  const context={calls:[],createCount:1,captureMode:'success',console,btoa:value=>Buffer.from(value,'utf8').toString('base64'),crypto:crypto.webcrypto,URL,Request,Response,TextEncoder};
  context.fetch=async(url,options={})=>{
    const requestUrl=String(url); context.calls.push({url:requestUrl,options});
    if(requestUrl.endsWith('/v1/oauth2/token'))return new Response(JSON.stringify({access_token:'test-token'}),{status:200});
    if(requestUrl.includes('/v2/checkout/orders/')&&requestUrl.endsWith('/capture')){
      const orderId=requestUrl.split('/').at(-2);
      if(context.captureMode==='api-error')return new Response(JSON.stringify({name:'INTERNAL_ERROR'}),{status:500});
      const amount=context.captureMode==='mismatch'?'0.01':'108.58';
      const status=context.captureMode==='pending'?'PENDING':'COMPLETED';
      return new Response(JSON.stringify({id:orderId,status:'COMPLETED',purchase_units:[{payments:{captures:[{id:`CAP-${context.captureCalls+1}`,status,amount:{currency_code:'USD',value:amount}}]}}]}),{status:200});
    }
    if(requestUrl.endsWith('/v2/checkout/orders')){
      const id=`PAY-TEST-${context.createCount++}`;
      return new Response(JSON.stringify({id,status:'CREATED'}),{status:201});
    }
    throw new Error(`Unexpected stub request: ${requestUrl}`);
  };
  context.captureCalls=0;
  const env={PAYPAL_CLIENT_ID:'live-client-stub',PAYPAL_CLIENT_SECRET:'live-secret-stub',PAYPAL_API_BASE:'https://api-m.paypal.com',ALLOWED_ORIGIN:'https://kitchopa.github.io',ORDERS:new FakeKV(),LIMITS:new FakeKV(),SHIPPING_AMOUNT:'0.00',TAX_AMOUNT:'0.00'};
  vm.runInNewContext(source,context);
  return {worker:context.worker,env,context};
}

const request=(url,body,origin='https://kitchopa.github.io',headers={})=>new Request(`https://worker.test${url}`,{method:body?'POST':'GET',headers:{origin,'content-type':'application/json',...headers},body:body?JSON.stringify(body):undefined});
const read=async response=>JSON.parse(await response.text());
const customer={firstName:'Test',lastName:'Buyer',email:'buyer@example.com',address:'1 Test Street',unit:'',city:'Casablanca',region:'Casablanca-Settat',postalCode:'20000',country:'MA'};
const items=[{id:1,qty:2},{id:2,qty:1},{id:10,qty:3}];

// Successful capture and duplicate capture protection.
const success=harness();
const created=await success.worker.fetch(request('/api/orders',{items,customer},undefined,{'Idempotency-Key':'live-success-key-123456'}),success.env);
assert.equal(created.status,200);
const createdBody=await read(created);
assert.equal(createdBody.totals.total,108.58);
assert.equal((await success.worker.fetch(request('/api/orders',{items,customer},undefined,{'Idempotency-Key':'live-success-key-123456'}),success.env)).status,200);
const capturePath=`/api/orders/${createdBody.id}/capture`;
const captured=await success.worker.fetch(request(capturePath,{customer}),success.env);
assert.equal(captured.status,200);
assert.equal((await read(captured)).status,'PAID');
const repeated=await success.worker.fetch(request(capturePath,{customer}),success.env);
assert.equal(repeated.status,200);
assert.equal((await read(repeated)).status,'PAID');
assert.equal(success.context.calls.filter(call=>call.url.endsWith('/capture')).length,1);

// Mismatched amount must fail closed and cannot be retried as a second capture.
const mismatch=harness(); mismatch.context.captureMode='mismatch';
const mismatchCreated=await mismatch.worker.fetch(request('/api/orders',{items:[{id:1,qty:1}],customer},undefined,{'Idempotency-Key':'live-mismatch-key-123456'}),mismatch.env);
const mismatchBody=await read(mismatchCreated);
const mismatchPath=`/api/orders/${mismatchBody.id}/capture`;
const mismatchResponse=await mismatch.worker.fetch(request(mismatchPath,{customer}),mismatch.env);
assert.equal(mismatchResponse.status,409);
assert.equal((await read(mismatchResponse)).status,'PAYMENT_FAILED');
const mismatchRetry=await mismatch.worker.fetch(request(mismatchPath,{customer}),mismatch.env);
assert.equal(mismatchRetry.status,409);
assert.equal((await read(mismatchRetry)).status,'PAYMENT_FAILED');
assert.equal(mismatch.context.calls.filter(call=>call.url.endsWith('/capture')).length,1);
assert.equal(await mismatch.env.ORDERS.get(`captured:${mismatchBody.id}`,'json'),null);

// Cancellation prevents capture and never creates a paid record.
const cancelled=harness();
const cancelledCreated=await cancelled.worker.fetch(request('/api/orders',{items:[{id:4,qty:1}],customer},undefined,{'Idempotency-Key':'live-cancel-key-123456'}),cancelled.env);
const cancelledBody=await read(cancelledCreated);
const cancelPath=`/api/orders/${cancelledBody.id}/cancel`;
assert.equal((await read(await cancelled.worker.fetch(request(cancelPath,{}),cancelled.env))).status,'CANCELLED');
assert.equal((await cancelled.worker.fetch(request(`/api/orders/${cancelledBody.id}/capture`,{customer}),cancelled.env)).status,409);
assert.equal(cancelled.context.calls.filter(call=>call.url.endsWith('/capture')).length,0);

// Invalid origin, invalid product, and unknown capture are rejected.
const rejects=harness();
assert.equal((await rejects.worker.fetch(request('/api/health',undefined,'https://evil.example'),rejects.env)).status,403);
assert.equal((await rejects.worker.fetch(request('/api/orders',{items:[{id:999,qty:1}],customer},undefined,{'Idempotency-Key':'live-invalid-key-123456'}),rejects.env)).status,400);
assert.equal((await rejects.worker.fetch(request('/api/orders/UNKNOWN/capture',{customer}),rejects.env)).status,404);

// There is no webhook route in this implementation; this is deliberately reported as not implemented.
const webhook=await rejects.worker.fetch(request('/api/webhooks/paypal',{}),rejects.env);
assert.equal(webhook.status,404);

console.log(JSON.stringify({
  successfulCapture:'VERIFIED_WITH_STUB',
  duplicateCapture:'VERIFIED_WITH_STUB',
  mismatchedAmount:'VERIFIED_WITH_STUB',
  failedOrderNotPaid:'VERIFIED_WITH_STUB',
  cancellation:'VERIFIED_WITH_STUB',
  invalidOrigin:'VERIFIED_WITH_STUB',
  invalidProduct:'VERIFIED_WITH_STUB',
  unknownCapture:'VERIFIED_WITH_STUB',
  webhookSignatureValidation:'NOT_IMPLEMENTED'
}));
