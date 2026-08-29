const $=s=>document.querySelector(s),$$=s=>[...document.querySelectorAll(s)];
let S={token:null,user:null,data:null,demo:false,mode:'login',demoEndsAt:0};
const CONFIG={
  paymentLink:'https://razorpay.me/@imperialaura6959',
  bank:null
};
const plans=[
 ['Starter',599,['Dashboard','Clients','Basic invoices','Goals']],['Growth',999,['Starter + Analytics','Projects','5 automations']],['Pro',1299,['Growth + AI','Unlimited clients','Advanced reports']],['Business',1599,['Pro + Team','Priority support','20 automations']],['Scale',1799,['Business + Workflows','Forecasting','API access']],['Agency',1899,['Scale + Client portals','White label','Permissions']],['Enterprise',1999,['Agency + Security','Custom workflows','Audit logs']],['Premium',2000,['Enterprise + Premium AI','Advanced forecasting']],['Ultimate',2000,['Premium + Unlimited automation','Integrations']],['Elite',2000,['Everything','VIP support','Maximum limits']]
];
const money=n=>'₹'+(+n||0).toLocaleString('en-IN');
const toast=x=>{let t=document.createElement('div');t.className='toast';t.textContent=x;document.body.append(t);setTimeout(()=>t.remove(),2600)};
async function api(u,o={}){o.headers={'Content-Type':'application/json',...(o.headers||{})};o.credentials='same-origin';let r=await fetch(u,o),d=await r.json().catch(()=>({error:'Unexpected server response'}));if(!r.ok)throw Error(d.error||'Something went wrong');return d}
function demoData(){return{stats:{revenue:184500,pending:72900,clients:24,projects:11},clients:[{id:'1',name:'Nova Labs',company:'Nova Labs',email:'hello@nova.io',value:48000,status:'Active'},{id:'2',name:'Orbit Retail',company:'Orbit Retail',email:'ops@orbit.in',value:72000,status:'Active'}],projects:[{id:'1',name:'Orbit Website 2.0',client:'Orbit Retail',budget:95000,progress:74,status:'Active'},{id:'2',name:'Nova SEO Engine',client:'Nova Labs',budget:62000,progress:42,status:'Active'},{id:'3',name:'Brand System',client:'Pixel Forge',budget:100000,progress:100,status:'Completed'}],invoices:[{id:'1',number:'INV-10482',client:'Nova Labs',amount:48000,due:'2026-09-05',status:'Paid'},{id:'2',number:'INV-10483',client:'Orbit Retail',amount:72900,due:'2026-09-12',status:'Pending'}],activities:[{text:'Payment received from Nova Labs',type:'payment'},{text:'Orbit Website reached 74%',type:'project'},{text:'New client added: Pixel Forge',type:'client'}]}}
function showApp(){ $('#auth').classList.add('hide');$('#app').classList.remove('hide');const uname=$('#uname');if(uname) uname.textContent=S.user?.name||'Demo User';render('overview') }
function stat(a,b,c){return `<div class="card stat"><div class="stathead"><span>${a}</span><b>◈</b></div><h3>${b}</h3><span class="trend">${c}</span></div>`}
function render(p){$$('.nav').forEach(x=>x.classList.toggle('on',x.dataset.page===p));$('#title').textContent=p[0].toUpperCase()+p.slice(1);let d=S.data||demoData();
 if(p==='overview')$('#content').innerHTML=`<div class="hero"><div><div class="eyebrow">GOOD MORNING 👋</div><h2>Command your growth.</h2><p class="muted">Everything important about your business in one workspace.</p></div><div class="actions"><button class="btn" data-modal="invoice">+ Invoice</button><button class="btn primary" data-modal="client">+ Client</button></div></div><div class="grid4">${stat('Revenue',money(d.stats.revenue),'↗ 18.4%')}${stat('Outstanding',money(d.stats.pending),'4 invoices pending')}${stat('Active clients',d.stats.clients,'↗ 12% this month')}${stat('Projects',d.stats.projects,'3 due this week')}</div><div class="grid2"><div class="card"><div class="section"><b>Revenue performance</b><span class="trend">● Live</span></div><div class="chart">${[42,58,47,73,65,88,70,96,82,91,76,100].map(h=>`<i class="bar" style="height:${h}%"></i>`).join('')}</div></div><div class="card"><div class="section"><b>Project pulse</b><button class="mini" data-page="projects">View all →</button></div>${d.projects.map(project).join('')}</div></div><div class="grid2"><div class="card tablecard"><div class="section"><b>Recent invoices</b><button class="mini" data-page="invoices">View all →</button></div><div class="tablewrap"><table><tr><th>Invoice</th><th>Client</th><th>Amount</th><th>Status</th></tr>${d.invoices.map(invoice).join('')}</table></div></div><div class="card"><b>Activity stream</b>${d.activities.map(a=>`<div class="feature"><b>✦ ${a.text}</b><p>Recently · Workspace activity</p></div>`).join('')}</div></div>`;
 else if(p==='clients')clients(d);else if(p==='projects')$('#content').innerHTML=`<div class="hero"><div><div class="eyebrow">DELIVERY</div><h2>Projects without chaos.</h2></div><button class="btn primary" data-modal="project">+ New project</button></div><div class="grid3">${d.projects.map(p=>`<div class="card"><div class="section"><span class="pill">${p.status}</span><b>${p.progress}%</b></div><h3>${p.name}</h3><p class="muted">${p.client}</p><div class="progress"><i style="width:${p.progress}%"></i></div><p class="muted">Budget ${money(p.budget)}</p></div>`).join('')}</div>`;
 else if(p==='invoices')invoicePage(d);else if(p==='analytics')analytics();else if(p==='pricing')pricing();else if(p==='ai')ai();else if(p==='chat')chat();else if(p==='notifications')notifications(d);else if(p==='account')account();else if(p==='settings')settings()}
function project(p){return `<div class="project"><div class="projecttop"><b>${p.name}</b><span>${p.progress}%</span></div><div class="progress"><i style="width:${p.progress}%"></i></div><small class="muted">${p.client} · ${money(p.budget)}</small></div>`}
function invoice(i){return `<tr><td><b>${i.number}</b></td><td>${i.client}</td><td>${money(i.amount)}</td><td><span class="pill ${i.status==='Paid'?'paid':'pending'}">${i.status}</span>${i.status==='Pending'?` <button class="mini" data-pay="${i.id}">Mark paid</button>`:''}</td></tr>`}
function clients(d){$('#content').innerHTML=`<div class="hero"><div><div class="eyebrow">RELATIONSHIPS</div><h2>Your clients, organized.</h2></div><button class="btn primary" data-modal="client">+ Add client</button></div><div class="card tablecard"><div class="tablewrap"><table><tr><th>Client</th><th>Company</th><th>Email</th><th>Value</th><th>Status</th></tr>${d.clients.map(c=>`<tr><td><b>${c.name}</b></td><td>${c.company}</td><td>${c.email}</td><td>${money(c.value)}</td><td><span class="pill paid">${c.status}</span></td></tr>`).join('')}</table></div></div>`}
function invoicePage(d){$('#content').innerHTML=`<div class="hero"><div><div class="eyebrow">CASHFLOW</div><h2>Invoices that get paid.</h2></div><button class="btn primary" data-modal="invoice">+ Create invoice</button></div><div class="grid3">${stat('Collected',money(d.stats.revenue),'Paid')}${stat('Outstanding',money(d.stats.pending),'Pending')}${stat('Collection rate','71.7%','↗ 4.1%')}</div><div class="card tablecard"><div class="tablewrap"><table><tr><th>Number</th><th>Client</th><th>Amount</th><th>Due</th><th>Status</th></tr>${d.invoices.map(i=>`<tr><td>${i.number}</td><td>${i.client}</td><td>${money(i.amount)}</td><td>${i.due||'—'}</td><td><span class="pill ${i.status==='Paid'?'paid':'pending'}">${i.status}</span>${i.status==='Pending'?` <button class="mini" data-pay="${i.id}">Mark paid</button>`:''}</td></tr>`).join('')}</table></div></div>`}
function analytics(){$('#content').innerHTML=`<div class="hero"><div><div class="eyebrow">PERFORMANCE</div><h2>Analytics that tell a story.</h2></div></div><div class="grid4">${stat('MRR','₹1,54,200','↗ 21.2%')}${stat('Conversion','34.8%','↗ 6.4%')}${stat('Avg. project','₹46,700','3.2 days faster')}${stat('Retention','92.4%','↗ 4.1%')}</div><div class="card"><div class="section"><b>12-month revenue trend</b><span class="trend">Growing</span></div><div class="chart">${[28,34,38,45,51,58,63,67,76,81,90,100].map(h=>`<i class="bar" style="height:${h}%"></i>`).join('')}</div></div>`}
function pricing(){$('#content').innerHTML=`<div class="hero"><div><div class="eyebrow">PLANS & BILLING</div><h2>Upgrade your workspace.</h2><p class="muted">Select a plan and pay securely through Razorpay. The selected price is shown before you continue.</p></div><div class="actions"><span class="pill">⚡ Secure Razorpay checkout</span></div></div><div class="pricegrid">${plans.map((x,i)=>`<div class="card price ${i===2?'feature':''}">${i===2?'<span class="tag">MOST POPULAR</span>':''}<div class="section"><h3>${x[0]}</h3><span class="pill">${i<4?'For teams':'Power users'}</span></div><div class="amount">${money(x[1])}<small>/month</small></div><ul>${x[2].map(f=>`<li>${f}</li>`).join('')}</ul><button class="${i===2?'primary':''}" data-plan="${x[0]}" data-price="${x[1]}">Select ${x[0]} →</button></div>`).join('')}</div>`}
function payment(plan,price){$('#modalbody').innerHTML=`<div class="payment"><div class="eyebrow">SECURE PAYMENT</div><h2>${plan} · ${money(price)}/month</h2><div class="card pay-summary"><div><span>Selected plan</span><b>${plan}</b></div><div><span>Amount to pay</span><b class="pay-amount">${money(price)}</b></div></div><p class="muted">You will be redirected to the official Razorpay payment page. Because this is a Razorpay payment link, enter exactly <b>${money(price)}</b> as the amount there.</p><a class="primary wide paylink" href="${CONFIG.paymentLink}" target="_blank" rel="noopener noreferrer">Pay ${money(price)} securely with Razorpay →</a><button class="secondary wide" id="paymentdone" data-plan="${plan}">I have completed payment</button><small class="notice">Payment verification is not automatic in this version because the supplied Razorpay link is a payment page rather than an API checkout integration. After payment, your request is marked pending for verification.</small></div>`;$('#modal').classList.remove('hide')}
function ai(){$('#content').innerHTML=`<div class="hero"><div><div class="eyebrow">AI WORKSPACE</div><h2>Your AI business copilot.</h2><p class="muted">Ask for ideas, summaries, sales copy or project plans.</p></div></div><div class="card"><div class="messages" id="messages"><div class="msg">Hi! I’m your SKYLIGHT AI demo assistant. What should we improve today?</div></div><div class="airow"><input id="aiinput" placeholder="Ask anything..."><button class="primary" id="aisend">Send</button></div></div>`}
function chat(){$('#content').innerHTML=`<div class="hero"><div><div class="eyebrow">COLLABORATION</div><h2>Team chat.</h2></div></div><div class="card"><div class="messages"><div class="msg">Aman: Homepage revision is ready.</div><div class="msg me">You: Great, I’ll review it today.</div></div><div class="airow"><input placeholder="Write a message..."><button class="primary" onclick="toast('Demo message sent')">Send</button></div></div>`}
function notifications(d){$('#content').innerHTML=`<div class="hero"><div><div class="eyebrow">UPDATES</div><h2>Nothing important gets missed.</h2></div></div><div class="card">${d.activities.map(a=>`<div class="feature"><b>✦ ${a.text}</b><p class="muted">Workspace notification</p></div>`).join('')}</div>`}
function account(){let u=S.user||{name:'Demo User',email:'demo@skylight.local',plan:'Starter'};let remaining=S.demo?Math.max(0,S.demoEndsAt-Date.now()):null;$('#content').innerHTML=`<div class="hero"><div><div class="eyebrow">ACCOUNT CENTER</div><h2>Your account.</h2><p class="muted">Manage your identity, plan and personal workspace preferences.</p></div><button class="btn primary" data-page="pricing">Upgrade plan →</button></div><div class="accountgrid"><div class="card profilecard"><div class="avatar">${(u.name||'U').slice(0,1).toUpperCase()}</div><div><h3>${u.name||'User'}</h3><p class="muted">${u.email||'Demo workspace'}</p><span class="pill">${u.plan||'Starter'} plan</span></div></div><div class="card"><div class="section"><b>Workspace status</b><span class="pill paid">● Active</span></div><p class="muted">Your data is linked to your account and stored by the SKYLIGHT backend when you are signed in.</p><button class="secondary wide" data-page="settings">Open settings</button></div></div><div class="grid2"><div class="card"><div class="section"><b>Profile details</b><span class="eyebrow">EDIT</span></div><label>Display name<input id="accountName" value="${String(u.name||'').replace(/"/g,'&quot;')}"></label><button class="primary" id="saveAccount">Save changes</button></div><div class="card demo-card"><div class="eyebrow">FREE DEMO</div><h3>10-minute workspace preview</h3><p class="muted">${S.demo?'Your demo is active. When the timer reaches zero, the workspace locks and asks you to subscribe.':'Your account is not in demo mode.'}</p>${S.demo?`<div class="big-timer" id="accountTimer">${fmt(remaining)}</div>`:''}<button class="secondary wide" data-page="pricing">View subscription plans</button></div></div>`;if($('#saveAccount'))$('#saveAccount').onclick=async()=>{let name=$('#accountName').value.trim();if(!name)return toast('Enter a name');if(S.demo){S.user.name=name;$('#uname').textContent=name;toast('Profile updated for this demo')}else{try{S.user=await api('/api/profile',{method:'PATCH',body:JSON.stringify({name})});$('#uname').textContent=S.user.name;toast('Profile saved')}catch(e){toast(e.message)}}};updateDemoTimer()}
function fmt(ms){let s=Math.ceil(ms/1000),m=Math.floor(s/60),sec=s%60;return `${String(m).padStart(2,'0')}:${String(sec).padStart(2,'0')}`}
function lockDemo(){if(!S.demo)return;localStorage.removeItem('skylight_demo_started');S.demo=false;S.data=null;toast('Your 10-minute demo has ended. Please choose a subscription.');render('pricing');document.querySelectorAll('.nav').forEach(n=>n.classList.remove('on'));let p=document.querySelector('[data-page=pricing]');if(p)p.classList.add('on')}
function updateDemoTimer(){let el=$('#demoTimer');if(!el)return;if(!S.demo){el.classList.add('hide');return}el.classList.remove('hide');let left=Math.max(0,S.demoEndsAt-Date.now());el.textContent=`${fmt(left)} demo`;if($('#accountTimer'))$('#accountTimer').textContent=fmt(left);if(left<=0){lockDemo();return}clearTimeout(window.demoTick);window.demoTick=setTimeout(updateDemoTimer,500)}
function settings(){$('#content').innerHTML=`<div class="hero"><div><div class="eyebrow">WORKSPACE</div><h2>Settings.</h2><p class="muted">Manage your workspace preferences.</p></div></div><div class="grid2"><div class="card"><b>Profile</b><label>Name<input id="setname" value="${S.user?.name||'Demo User'}"></label><button class="primary" id="saveprofile">Save profile</button></div><div class="card"><b>Theme</b><p class="muted">Use the ◐ button in the top bar to switch between dark and light mode.</p></div></div>`}
function openModal(type){let body=type==='client'?`<div class="eyebrow">CLIENT</div><h2>Add client</h2><form id="mform"><label>Name<input name="name" required></label><label>Company<input name="company"></label><label>Email<input name="email" type="email"></label><label>Value<input name="value" type="number"></label><button class="primary wide">Create client</button></form>`:type==='project'?`<div class="eyebrow">PROJECT</div><h2>New project</h2><form id="mform"><label>Name<input name="name" required></label><label>Client<input name="client"></label><label>Budget<input name="budget" type="number"></label><label>Progress<input name="progress" type="number" min="0" max="100" value="0"></label><button class="primary wide">Create project</button></form>`:`<div class="eyebrow">INVOICE</div><h2>Create invoice</h2><form id="mform"><label>Client<input name="client" required></label><label>Amount<input name="amount" type="number" required></label><label>Due date<input name="due" type="date"></label><button class="primary wide">Create invoice</button></form>`;$('#modalbody').innerHTML=body;$('#modal').classList.remove('hide');$('#mform').onsubmit=async e=>{e.preventDefault();if(S.demo){toast('Demo mode: saved visually');$('#modal').classList.add('hide');return}try{await api('/api/'+(type==='client'?'clients':type==='project'?'projects':'invoices'),{method:'POST',body:JSON.stringify(Object.fromEntries(new FormData(e.target)))});$('#modal').classList.add('hide');await loadData();toast('Created successfully')}catch(err){toast(err.message)}}}
async function loadData(){try{S.data=await api('/api/dashboard')}catch(e){S.data=demoData()}render($('#title').textContent.toLowerCase())}
function colorPicker(){let colors=[['Violet','#7c5cff'],['Electric Blue','#2d8cff'],['Cyan','#00c7d9'],['Emerald','#16b67a'],['Mint','#39d98a'],['Pink','#e84dcf'],['Rose','#ff5f8f'],['Orange','#ff8a3d'],['Amber','#f5b942'],['Red','#ff5b5b'],['Indigo','#536dfe'],['Sky','#38bdf8'],['Lime','#9ad83b']];$('#modalbody').innerHTML=`<div class="eyebrow">PERSONALIZE</div><h2>Make SKYLIGHT yours.</h2><p class="muted">Choose an accent colour. Your preference is saved on this device.</p><div class="swatches">${colors.map(c=>`<button style="--sw:${c[1]}" data-color="${c[1]}"><i></i><span>${c[0]}</span><small>${c[1]}</small></button>`).join('')}</div><label class="customcolor">Custom colour<input id="customColor" type="color" value="${localStorage.getItem('skylight_color')||'#7c5cff'}"></label><button class="primary wide" id="applyCustom">Apply custom colour</button>`;$('#modal').classList.remove('hide');$('#applyCustom').onclick=()=>{applyColor($('#customColor').value);$('#modal').classList.add('hide')}}
function applyColor(c){document.documentElement.style.setProperty('--accent',c);document.documentElement.style.setProperty('--grad',`linear-gradient(135deg,${c},#b44dff)`);document.documentElement.style.setProperty('--accent-rgb','124,92,255');localStorage.setItem('skylight_color',c);toast('Accent color updated')}
async function activatePlan(plan,price){localStorage.setItem('skylight_pending_plan',plan);if(S.demo){toast(`${plan} payment submitted — demo mode`);$('#modal').classList.add('hide');return}try{await api('/api/billing/payment-request',{method:'POST',body:JSON.stringify({plan,amount:+price})});toast(`${plan} payment submitted — verification pending`);$('#modal').classList.add('hide');}catch(err){toast(err.message)}}
$$('[data-mode]').forEach(b=>b.onclick=()=>{S.mode=b.dataset.mode;$$('[data-mode]').forEach(x=>x.classList.toggle('on',x===b));$('#namel').classList.toggle('hide',S.mode!=='register');$('#authform button').textContent=S.mode==='register'?'Create workspace →':'Enter workspace →'});
document.addEventListener('click',async e=>{
  const social=e.target.closest('[data-social-login]');
  if(!social)return;
  const provider=social.dataset.socialLogin;
  social.disabled=true;
  try{
    const r=await fetch('/api/auth/'+provider);
    const d=await r.json().catch(()=>({}));
    if(r.ok&&d.url){window.location.href=d.url;return}
    toast(d.error||`${provider==='google'?'Google':'Microsoft'} sign-in is not configured yet`);
  }catch(err){toast('Social sign-in is unavailable right now')}
  finally{social.disabled=false}
});
$('#authform').onsubmit=async e=>{e.preventDefault();let body={email:$('#email').value,password:$('#pass').value};if(S.mode==='register')body.name=$('#name').value;try{let d=await api('/api/auth/'+(S.mode==='register'?'register':'login'),{method:'POST',body:JSON.stringify(body)});S.token=null;S.user=d.user;await loadData();showApp()}catch(err){toast(err.message)}};
$('#demo').onclick=()=>{S.demo=true;S.demoEndsAt=Date.now()+10*60*1000;S.user={name:'Demo User',email:'demo@skylight.local',plan:'Starter'};S.data=demoData();localStorage.setItem('skylight_demo_started',String(S.demoEndsAt));showApp();updateDemoTimer();toast('10-minute demo started')};
document.addEventListener('click',async e=>{let nav=e.target.closest('[data-page]');if(nav){e.preventDefault();e.stopPropagation();render(nav.dataset.page);if(innerWidth<700)$('#side').classList.remove('open');return}let plan=e.target.closest('[data-plan]');if(plan){payment(plan.dataset.plan,+plan.dataset.price);return}let done=e.target.closest('#paymentdone');if(done){await activatePlan(done.dataset.plan, +done.closest('.payment').querySelector('.pay-amount').textContent.replace(/[^0-9]/g,''));return}let copy=e.target.closest('[data-copy]');if(copy){navigator.clipboard?.writeText(copy.dataset.copy);toast('Copied');return}let modal=e.target.closest('[data-modal]');if(modal){openModal(modal.dataset.modal);return}let pay=e.target.closest('[data-pay]');if(pay){if(S.demo){toast('Demo invoice marked paid');return}try{await api('/api/invoices/'+pay.dataset.pay+'/pay',{method:'PATCH'});await loadData();toast('Invoice marked paid')}catch(err){toast(err.message)}return}let close=e.target.closest('#close,.back');if(close){$('#modal').classList.add('hide');return}let col=e.target.closest('[data-color]');if(col){applyColor(col.dataset.color);return}});
$('#colors').onclick=()=>colorPicker();$('#menu').onclick=()=>$('#side').classList.toggle('open');$('#theme').onclick=()=>{document.body.classList.toggle('light');localStorage.setItem('skylight_theme',document.body.classList.contains('light')?'light':'dark')};$('#logout').onclick=async(e)=>{e.preventDefault();try{await fetch('/api/auth/logout',{method:'POST',credentials:'same-origin'})}catch(_){}localStorage.removeItem('skylight_demo_started');localStorage.removeItem('skylight_pending_plan');S.token=null;S.user=null;S.data=null;S.demo=false;$('#side')?.classList.remove('open');location.reload()};document.addEventListener('click',async e=>{if(e.target.id==='aisend'){let i=$('#aiinput'),v=i.value.trim();if(!v)return;$('#messages').innerHTML+=`<div class="msg me">${v.replace(/[<>&]/g,m=>({'<':'&lt;','>':'&gt;','&':'&amp;'}[m]))}</div><div class="msg">Demo AI: I’d turn that into a clear action plan with measurable next steps.</div>`;i.value=''}});
(async () => {
  let c = localStorage.getItem('skylight_color');
  if (c) applyColor(c);

  if (localStorage.getItem('skylight_theme') === 'light') {
    document.body.classList.add('light');
  }

  // Always show login/signup when the website opens.
  $('#auth').classList.remove('hide');
  $('#app').classList.add('hide');
})();


/* SKYLIGHT Theme Studio */
(() => {
  const presets = [
    "#6d5dfc","#2563eb","#06b6d4","#0ea5e9","#10b981",
    "#22c55e","#84cc16","#eab308","#f97316","#ef4444",
    "#ec4899","#a855f7","#14b8a6"
  ];

  function applyTheme(color, save = true) {
    document.documentElement.style.setProperty("--skylight-accent", color);
    document.documentElement.style.setProperty("--accent", color);
    document.documentElement.style.setProperty("--primary", color);
    document.documentElement.style.setProperty("--theme-color", color);
    document.documentElement.style.setProperty("--skylight-accent-2", color);
    if (save) localStorage.setItem("skylight-theme-color", color);
    document.querySelectorAll(".skylight-swatch").forEach(s =>
      s.classList.toggle("active", s.dataset.color.toLowerCase() === color.toLowerCase())
    );
    const picker = document.querySelector("#skylight-custom-color");
    if (picker) picker.value = color;
  }

  function build() {
    if (document.querySelector(".skylight-theme-btn")) return;

    const button = document.createElement("button");
    button.className = "skylight-theme-btn";
    button.type = "button";
    button.textContent = "🎨 Colour";
    button.addEventListener("click", () => {
      panel.hidden = !panel.hidden;
    });

    const panel = document.createElement("section");
    panel.className = "skylight-theme-studio";
    panel.hidden = true;
    panel.innerHTML = `
      <div class="skylight-theme-head">
        <div>
          <div class="skylight-theme-title">Colour Studio</div>
          <small>Choose your brand colour</small>
        </div>
        <button class="skylight-theme-close" type="button" aria-label="Close">×</button>
      </div>
      <div class="skylight-theme-grid"></div>
      <div class="skylight-custom">
        <input id="skylight-custom-color" type="color" value="#6d5dfc" />
        <div><strong>Custom colour</strong><br><small>Pick any colour</small></div>
      </div>
    `;

    const grid = panel.querySelector(".skylight-theme-grid");
    presets.forEach(color => {
      const swatch = document.createElement("button");
      swatch.type = "button";
      swatch.className = "skylight-swatch";
      swatch.dataset.color = color;
      swatch.style.background = color;
      swatch.title = color;
      swatch.addEventListener("click", () => applyTheme(color));
      grid.appendChild(swatch);
    });

    panel.querySelector(".skylight-theme-close").addEventListener("click", () => {
      panel.hidden = true;
    });

    panel.querySelector("#skylight-custom-color").addEventListener("input", e => {
      applyTheme(e.target.value);
    });

    document.body.append(button, panel);

    const saved = localStorage.getItem("skylight-theme-color");
    applyTheme(saved || presets[0], false);
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", build);
  } else {
    build();
  }
})();








