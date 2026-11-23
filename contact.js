const contactConfig=window.MORROW_CONTACT_CONFIG||{};
const contactForm=document.querySelector('#contact-form');
const contactStatus=document.querySelector('#contact-status');
const copyStatus=document.querySelector('#copy-status');
const escapeHTML=value=>String(value??'').replace(/[&<>"']/g,character=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[character]));
const apiUrl=path=>`${String(contactConfig.apiBase||'').replace(/\/$/,'')}${path}`;
function setContactStatus(message,type=''){contactStatus.textContent=message;contactStatus.dataset.type=type}
document.querySelector('#copy-support').addEventListener('click',async event=>{
  const email=event.currentTarget.dataset.email;
  try{await navigator.clipboard.writeText(email);copyStatus.textContent='Copied support email.'}
  catch{copyStatus.textContent=`Copy unavailable — email ${email} directly.`}
});
contactForm.addEventListener('submit',async event=>{
  event.preventDefault();
  const formData=new FormData(contactForm); const values=Object.fromEntries(formData.entries());
  if(values.website){setContactStatus('Your request could not be sent.','error');return}
  const required=['fullName','email','subject','message']; const missing=required.some(key=>!String(values[key]||'').trim());
  if(missing||!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(values.email)){setContactStatus('Please complete the required fields with a valid email.','error');return}
  if(!contactConfig.apiBase){setContactStatus(`The secure form service is not connected yet. Please email ${contactConfig.supportEmail||'support'} directly.`,'error');return}
  const button=contactForm.querySelector('button[type=submit]'); button.disabled=true; button.dataset.originalText=button.textContent; button.textContent='Sending…'; setContactStatus('');
  try{
    const response=await fetch(apiUrl('/api/contact'),{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(values)});
    const result=await response.json().catch(()=>({}));
    if(!response.ok)throw new Error(result.error||'The support request could not be sent.');
    contactForm.reset(); setContactStatus('Message accepted by the support service. A reply will come from the store inbox.','success');
  }catch(error){setContactStatus(error.message||'The support request could not be sent.','error')}
  finally{button.disabled=false;button.textContent=button.dataset.originalText}
});
