// One causal engine shared by the collector's Node evaluator and browser scenarios.
export const ENGINE_VERSION='FITD-CTA-MODELS-20261103-v2';
export const MODEL_IDS=['MOP','BAZ','MS'];
export const ALL_MODEL_IDS=['MOP','BAZ','MS','MS_RISK','FITD','MIX','MS_CAP'];
export const POLICY_DEFAULTS=Object.freeze({countryCap:.4,portfolioCap:.65,overlapCap:.15,buffer:.1,shrinkage:.1});
export const MODEL_INFO={
 MOP:{name:'MOP',description:'21·63·252관측 추세 방향 평균 · FITD 변형',color:'#ffad69'},
 BAZ:{name:'Baz',description:'8/24·16/48·32/96 EWMA · 비선형 응답',color:'#91b5ff'},
 MS:{name:'MS 참고형',description:'반감기 5와 21~126의 여섯 조합 · 비공개 보정은 FITD 가정',color:'#6bd9b5'},
 MS_RISK:{name:'MS + 위험 관리',description:'MS 원형 + 국가·상관·TY/UXY 위험 상한',color:'#91b5ff'},
 FITD:{name:'FITD CTA · MS 기반',description:'MS 원형 + 위험 상한 + 최종 포지션 밴드',color:'#d6abff'},
 MIX:{name:'사용자 혼합',description:'MOP·Baz·MS의 사용자 비중 · 비교 전용',color:'#a1adbf'},
 MS_CAP:{name:'MS 과열보정 연구',description:'동일 여섯 조합 · 단조 포화 함수 tanh(z/0.89) · 미채택 연구',color:'#e6d18b'},
 JPM:{name:'JPM 참고형',description:'옵션 델타·적응형 산식 보완 후 검증 예정',status:'RESEARCH'}
};
export const RULES={mop:[21,63,252],baz:[[8,24],[16,48],[32,96]],msSlow:[21,42,63,84,105,126],
 msFastHalfLife:5,msSmoothHalfLife:3,normalization:252,signalBand:.1,volHalfLives:[11,23],volFloorFraction:.25};
const finite=Number.isFinite;
const sum=a=>a.reduce((s,x)=>s+x,0);
const sign=x=>Math.abs(x)<1e-12?0:Math.sign(x);
function rolling(n){return {n,values:[],sum:0,squares:0,count:0};}
function push(r,v){r.values.push(v);if(finite(v)){r.sum+=v;r.squares+=v*v;r.count++;}if(r.values.length>r.n){const old=r.values.shift();if(finite(old)){r.sum-=old;r.squares-=old*old;r.count--;}}}
function sd(r){return r.count===r.n?Math.sqrt(Math.max(0,(r.squares-r.sum*r.sum/r.n)/(r.n-1))):null;}
function median(r){if(r.count!==r.n)return null;const a=[...r.values].sort((a,b)=>a-b);return (a[(r.n-1)>>1]+a[r.n>>1])/2;}
function ema(alpha,min=1){return {alpha,min,n:0,mean:0,variance:0,squareWeights:1};}
function half(h,min=1){return ema(1-Math.pow(.5,1/h),min);}
function updateEMA(e,x){if(!finite(x))return null;if(!e.n){e.mean=x;e.n=1;}else{const a=e.alpha,d=x-e.mean;e.mean+=a*d;e.variance=(1-a)*(e.variance+a*d*d);e.squareWeights=(1-a)**2*e.squareWeights+a*a;e.n++;}return e.n>=e.min?e.mean:null;}
function emaSD(e){return e.n>=e.min&&e.squareWeights<1?Math.sqrt(Math.max(0,e.variance/(1-e.squareWeights))):null;}
function response(z){return Math.max(-1,Math.min(1,z*Math.exp(-z*z/4)/.89));}
function state(){return {prices:[],previous:null,priceVol:rolling(63),
 baz:RULES.baz.map(([s,l])=>({fast:ema(1/s,s),slow:ema(1/l,l),normal:rolling(252)})),
 ms:RULES.msSlow.map(l=>({fast:half(5,5),slow:half(l,l),normal:rolling(252)})),
 smooth:half(3,3),capSmooth:half(3,3),vol:[half(11,23),half(23,23)],floor:rolling(252),band:{MOP:0,BAZ:0,MS:0,MS_CAP:0},
 lastBand:{MOP:null,BAZ:null,MS:null,MS_CAP:null}};}
export function normalizeWeights(input=[1,1,1]){
 if(!Array.isArray(input)||input.length!==3||input.some(x=>!finite(x)||x<0||x>100)||sum(input)<=0)throw Error('모델 비중은 0~100의 숫자로 입력하고 하나 이상을 선택하세요.');
 const total=sum(input);return input.map(x=>x/total);
}
function advance(s,price,fx,meta,date){
 const delta=s.previous===null?null:price-s.previous;s.previous=price;s.prices.push(price);if(s.prices.length>253)s.prices.shift();push(s.priceVol,delta);
 const pvol=sd(s.priceVol),mop=s.prices.length===253?sum(RULES.mop.map(n=>sign(price-s.prices[s.prices.length-1-n])))/3:null;
 const baz=s.baz.map(k=>{const fast=updateEMA(k.fast,price),slow=updateEMA(k.slow,price),x=finite(fast)&&finite(slow)&&pvol>1e-12?(fast-slow)/pvol:null;push(k.normal,x);const std=sd(k.normal);return finite(x)&&std>1e-12?response(x/std):null;});
 const msRaw=s.ms.map(k=>{const fast=updateEMA(k.fast,price),slow=updateEMA(k.slow,price),x=finite(fast)&&finite(slow)?fast-slow:null;push(k.normal,x);const std=sd(k.normal);return finite(x)&&std>1e-12?x/std:null;});
 const ms=msRaw.map(z=>finite(z)?response(z):null),cap=msRaw.map(z=>finite(z)?Math.tanh(z/.89):null);
 const msAverage=ms.every(finite)?sum(ms)/6:null,msSignal=updateEMA(s.smooth,msAverage);
 const capSignal=updateEMA(s.capSmooth,cap.every(finite)?sum(cap)/6:null);
 const signals={MOP:mop,BAZ:baz.every(finite)?sum(baz)/3:null,MS:msSignal,MS_CAP:capSignal};
 const unitMove=finite(delta)?delta*meta.point_value*fx:null;
 s.vol.forEach(e=>updateEMA(e,unitMove));const vols=s.vol.map(emaSD),base=vols.every(finite)?Math.max(...vols):null;push(s.floor,base);
 const med=median(s.floor),sigma=base>1e-10&&finite(med)?Math.max(base,med*.25):null;
 const targets={},bands={};
 [...MODEL_IDS,'MS_CAP'].forEach(id=>{const v=signals[id];if(finite(v)){if(Math.abs(v-s.band[id])>=RULES.signalBand-1e-12){s.band[id]=v;s.lastBand[id]=date;}bands[id]=s.band[id];targets[id]=sigma>1e-10?meta.risk_weight*s.band[id]/sigma:null;}else{bands[id]=null;targets[id]=null;}});
 return {date,signals,bands,targets,sigma,unitMove,lastBand:{...s.lastBand},ms:{rawZ:msRaw,corrected:ms,cap,groups:[0,2,4].map(j=>finite(ms[j])&&finite(ms[j+1])?(ms[j]+ms[j+1])/2:null)}};
}
// Streaming access for the separate momentum/CTA research engine; CTA math is unchanged.
export {state as createSignalState,advance as advanceSignalState};
export function createEngine(data){
 if(!Array.isArray(data?.instruments)||data.instruments.length!==9)throw Error('고정 9상품의 선물 데이터가 필요합니다.');
 const instruments=data.instruments.map(meta=>{
  if(!meta.history?.length||![meta.point_value,meta.tick_size,meta.risk_weight].every(x=>finite(x)&&x>0))throw Error((meta.id||'상품')+' 원천 준비가 필요합니다.');
  const s=state(),frames=[];let previous='';
  meta.history.forEach(row=>{if(row.length<9||row[0]<=previous||![row[1],row[2],row[3],row[6]].every(finite)||row[6]<=0)throw Error(meta.id+' 관측 배열 오류');previous=row[0];frames.push(advance(s,row[1],row[6],meta,row[0]));});
  return {meta,frames,state:s};
 });
 return {version:ENGINE_VERSION,data,instruments};
}
function mix(targets,weights){let v=0;for(let i=0;i<3;i++){if(weights[i]>0){if(!finite(targets[MODEL_IDS[i]]))return null;v+=weights[i]*targets[MODEL_IDS[i]];}}return v;}
function values(f,weights,key='targets'){return {...f[key],FITD:mix(f[key],weights)};}
function contractRiskCorrelation(engine){
 const maps=engine.instruments.map(i=>new Map(i.frames.filter(f=>finite(f.unitMove)).map(f=>[f.date,f.unitMove])));
 const dates=[...maps[0].keys()].filter(d=>maps.every(m=>m.has(d))).slice(-126);
 if(dates.length<60)return null;
 const xs=maps.map(m=>dates.map(d=>m.get(d))),means=xs.map(a=>sum(a)/a.length),dev=xs.map((a,j)=>a.map(x=>x-means[j]));
 return {observations:dates.length,matrix:dev.map(a=>dev.map(b=>{const denom=Math.sqrt(sum(a.map(x=>x*x))*sum(b.map(x=>x*x)));return denom>0?sum(a.map((x,i)=>x*b[i]))/denom:0;}))};
}
function performance(engine,weights,budget,costTicks){
 const ids=[...MODEL_IDS,'FITD'],byDay=new Map(),assets=Object.fromEntries(ids.map(id=>[id,{}]));let complete=true;
 for(const instrument of engine.instruments){
  const {meta,frames}=instrument,previous=Object.fromEntries(ids.map(id=>[id,0]));let started=false;
  for(let i=1;i<frames.length;i++){
   const f=frames[i],row=meta.history[i];if(f.date<'2022-01-01')continue;
   const targets=values(frames[i-1],weights);if(!ids.every(id=>finite(targets[id]))){complete=false;continue;}
   const bucket=byDay.get(f.date)||Object.fromEntries(ids.map(id=>[id,{gross:0,cost:0,net:0,turnover:0,assets:{}}]));
   for(const id of ids){
    const q=targets[id]*budget,old=previous[id],turnover=row[5]?Math.abs(old)+Math.abs(q):Math.abs(q-old),
     gross=(old*row[2]+q*row[3])*meta.point_value*row[6],cost=turnover*meta.tick_size*meta.point_value*row[6]*costTicks;
    bucket[id].gross+=gross;bucket[id].cost+=cost;bucket[id].net+=gross-cost;bucket[id].turnover+=turnover;
    bucket[id].assets[meta.id]={gross,cost,net:gross-cost,turnover,rolled:!!row[5]};
    previous[id]=q;
   }
   started=true;byDay.set(f.date,bucket);
  }
  if(!started)complete=false;
 }
 const dates=[...byDay.keys()].sort(),result={};
 for(const id of ids){
  let cumulative=0,peak=0,mdd=0,gross=0,cost=0,positive=0;
  const annual=new Map(),daily=[];
  for(const date of dates){const d=byDay.get(date)[id],year=date.slice(0,4);cumulative+=d.net;peak=Math.max(peak,cumulative);mdd=Math.max(mdd,peak-cumulative);gross+=d.gross;cost+=d.cost;if(d.net>0)positive++;
   const y=annual.get(year)||{year,gross:0,cost:0,net:0,cumulative:0,peak:0,mdd:0,assets:{}};
   y.gross+=d.gross;y.cost+=d.cost;y.net+=d.net;y.cumulative+=d.net;y.peak=Math.max(y.peak,y.cumulative);y.mdd=Math.max(y.mdd,y.peak-y.cumulative);
   for(const [core,v]of Object.entries(d.assets)){y.assets[core]=(y.assets[core]||0)+v.net;assets[id][core]=(assets[id][core]||0)+v.net;}
   annual.set(year,y);daily.push({date,gross:d.gross,cost:d.cost,net:d.net,cumulative,drawdown:peak-cumulative,assets:d.assets});
  }
  result[id]={available:complete,start:dates[0]||null,end:dates.at(-1)||null,gross,cost,net:gross-cost,mdd,positiveDays:positive,observations:dates.length,annual:[...annual.values()],daily,assets:assets[id]};
 }
 return result;
}
function baseEvaluate(engine,{weights=[1,1,1],riskBudget=10000,costTicks=1,includePerformance=true}={}){
 weights=normalizeWeights(weights);if(!finite(riskBudget)||riskBudget<=0||riskBudget>1e7)throw Error('일간 위험 예산은 USD 1~10,000,000 범위로 입력하세요.');
 if(!finite(costTicks)||costTicks<0||costTicks>10)throw Error('편도 비용은 0~10틱 범위로 입력하세요.');
 const rows=engine.instruments.map(i=>{
  const {meta,frames}=i,last=frames.at(-1),prev=frames.at(-2),target=values(last,weights),current=prev?values(prev,weights):{},signals=values(last,weights,'signals'),bands=values(last,weights,'bands');
  const sens=meta.sensitivity?.available?meta.sensitivity.usd_per_bp_per_contract:null;
  const models=Object.fromEntries([...MODEL_IDS,'FITD'].map(id=>[id,{signal:signals[id],band:bands[id],current:finite(current[id])?current[id]*riskBudget:null,target:finite(target[id])?target[id]*riskBudget:null,
   delta:finite(target[id])&&finite(current[id])?(target[id]-current[id])*riskBudget:null,lastBandChange:last.lastBand[id]||null}]));
  const rawSigns=MODEL_IDS.map(id=>finite(signals[id])?sign(signals[id]):null),positive=rawSigns.filter(x=>x===1).length,negative=rawSigns.filter(x=>x===-1).length;
  return {id:meta.id,name:meta.name,country:meta.country,contract:meta.contract,last:meta.last,price:meta.last_price,weight:meta.risk_weight,sigmaUSD:last.sigma,
   fresh:meta.quality?.fresh===true,sourceAvailable:meta.available===true,sensitivity:sens,sensitivityR2:meta.sensitivity?.r_squared??null,benchmark:meta.benchmark,
   models,agreement:Math.max(positive,negative),agreementSide:positive>negative?'LONG':negative>positive?'SHORT':'MIXED',
   estimatedDV01:finite(sens)&&finite(models.FITD.current)?sens*models.FITD.current:null};
 });
 const correlation=contractRiskCorrelation(engine),risk=[];
 const totals=Object.fromEntries([...MODEL_IDS,'FITD'].map(id=>{
  const qs=rows.map(r=>r.models[id].target),riskVector=rows.map((r,j)=>finite(qs[j])&&finite(r.sigmaUSD)?qs[j]*r.sigmaUSD:0);
  const variance=correlation?sum(riskVector.map((v,j)=>sum(riskVector.map((u,k)=>v*u*correlation.matrix[j][k])))):null;
  return [id,{longs:rows.filter(r=>r.models[id].target>1e-10).length,shorts:rows.filter(r=>r.models[id].target< -1e-10).length,
   neutral:rows.filter(r=>finite(r.models[id].target)&&Math.abs(r.models[id].target)<=1e-10).length,
   riskUsed:sum(riskVector.map(Math.abs)),estimatedDailyRisk:finite(variance)?Math.sqrt(Math.max(0,variance)):null,
   estimatedDV01:rows.every(r=>finite(r.sensitivity)&&finite(r.models[id].current))?sum(rows.map(r=>r.sensitivity*r.models[id].current)):null,
   nextEstimatedDV01:rows.every(r=>finite(r.sensitivity)&&finite(r.models[id].target))?sum(rows.map(r=>r.sensitivity*r.models[id].target)):null}];
 }));
 return {version:ENGINE_VERSION,weights,riskBudget,costTicks,rows,totals,correlation,
  performance:includePerformance?performance(engine,weights,riskBudget,costTicks):null};
}
export function historySeries(engine,core,model,weights=[1,1,1],budget=10000){
 const i=engine.instruments.find(i=>i.meta.id===core);if(!i)return [];weights=normalizeWeights(weights);
 return i.frames.map((f,j)=>({date:f.date,signal:values(f,weights,'signals')[model],target:finite(values(f,weights)[model])?values(f,weights)[model]*budget:null,
  current:j>0&&finite(values(i.frames[j-1],weights)[model])?values(i.frames[j-1],weights)[model]*budget:null}));
}
export function projectInstrument(instrument,{steps=10,move=0,unit='bp',shape='gradual',freezeVol=false,weights=[1,1,1],riskBudget=10000}={}){
 if(!Number.isInteger(steps)||steps<1||steps>20||!finite(move)||Math.abs(move)>100||!['bp','sigma'].includes(unit)||!['gradual','jump'].includes(shape)||!finite(riskBudget)||riskBudget<=0||riskBudget>1e7)throw Error('시나리오 범위를 확인하세요.');
 weights=normalizeWeights(weights);const {meta}=instrument,s=structuredClone(instrument.state),last=instrument.frames.at(-1),previous=instrument.frames.at(-2),sigma=last.sigma;
 const current=values(previous,weights),known=values(last,weights),sens=meta.sensitivity;
 if(unit==='bp'&&move!==0&&!sens?.available)return {available:false,reason:'금리 회귀 민감도 미확정',id:meta.id};
 if(!MODEL_IDS.every(id=>finite(known[id]))||!finite(sigma))return {available:false,reason:'모델 준비 관측 부족',id:meta.id};
 const fx=meta.history.at(-1)[6],sigmaPoints=sigma/(meta.point_value*fx),endpoint=unit==='bp'?(sens?.points_per_bp||0)*move:move*sigmaPoints*Math.sqrt(steps),path=[];
 let price=meta.history.at(-1)[1],prior=known;
 for(let k=1;k<=steps;k++){
  price+=shape==='jump'?(k===1?endpoint:0):endpoint/steps;
  const f=advance(s,price,fx,meta,'D+'+k);
  if(freezeVol&&sigma>0){f.sigma=sigma;[...MODEL_IDS,'MS_CAP'].forEach(id=>{f.targets[id]=finite(f.bands[id])?meta.risk_weight*f.bands[id]/sigma:null;});}
  const next=values(f,weights),models={};
  for(const id of [...MODEL_IDS,'MS_CAP','FITD'])models[id]={applied:prior[id]*riskBudget,closeTarget:next[id]*riskBudget,
   openTrade:(prior[id]-(k===1?current[id]:path[k-2].models[id].applied/riskBudget))*riskBudget,
   deltaFromCurrent:(next[id]-current[id])*riskBudget,nextTrade:(next[id]-prior[id])*riskBudget,signal:values(f,weights,'signals')[id]};
  models.MIX=models.FITD;path.push({step:k,signalPrice:price,sigmaUSD:f.sigma,models,frame:f});prior=next;
 }
 return {available:true,id:meta.id,steps,move,unit,shape,freezeVol,current:Object.fromEntries(Object.entries(current).map(([k,v])=>[k,v*riskBudget])),
  knownNext:Object.fromEntries(Object.entries(known).map(([k,v])=>[k,v*riskBudget])),path,
  estimatedSensitivity:sens?.available?sens.usd_per_bp_per_contract:null,
  crossesRoll:meta.next_roll_schedule&&Date.parse(meta.next_roll_schedule)-Date.parse(meta.last)<steps*1.6*86400000};
}
function baseScenario(engine,options={}){
 const {scope='ALL',curve=false,instrumentOnly=null,...settings}=options;
 return engine.instruments.map(i=>{
  const tenor=Number(i.meta.benchmark?.match(/\d+/)?.[0])||10;
  const multiplier=curve&&settings.unit!=='sigma'?Math.max(0,Math.min(1,(tenor-2)/8))-.5:1;
  return projectInstrument(i,{...settings,move:(!instrumentOnly||i.meta.id===instrumentOnly)&&(scope==='ALL'||scope===i.meta.country)?(settings.move||0)*multiplier:0});
 });
}
export function nearestTurn(instrument,options={}){
 if(!instrument.meta.sensitivity?.available)return {available:false,reason:'금리 민감도 미확정'};
 const base=projectInstrument(instrument,{...options,steps:1,move:0,unit:'bp'}),model=options.model||'FITD';
 if(!base.available)return base;
 const side=sign(base.path[0].models[model].closeTarget),hits=[];
 for(const direction of [-1,1])for(let magnitude=1;magnitude<=50;magnitude++){
  const p=projectInstrument(instrument,{...options,steps:1,move:magnitude*direction,unit:'bp',shape:'jump'}),target=p.path[0].models[model].closeTarget;
  if(sign(target)!==side){hits.push({moveBp:magnitude*direction,target,side:sign(target)});break;}
 }
 return {available:true,baselineSide:side,hits,rangeBp:50,precisionBp:1};
}

export function normalizePolicy(input={}){
 const p={...POLICY_DEFAULTS,...input};
 for(const [key,lo,hi]of [['countryCap',.05,.5],['portfolioCap',.1,1],['overlapCap',.02,.2],['buffer',0,.5],['shrinkage',0,.5]])
  if(!finite(p[key])||p[key]<lo||p[key]>hi)throw Error('위험 관리 범위를 확인하세요: '+key);
 return p;
}
function correlationFromSamples(samples,shrinkage){
 if(samples.length<60)return null;
 const xs=samples[0].map((_,j)=>samples.map(a=>a[j])),means=xs.map(a=>sum(a)/a.length),dev=xs.map((a,j)=>a.map(x=>x-means[j]));
 return dev.map((a,j)=>dev.map((b,k)=>{if(j===k)return 1;const denom=Math.sqrt(sum(a.map(x=>x*x))*sum(b.map(x=>x*x)));return denom>1e-20?(1-shrinkage)*sum(a.map((x,n)=>x*b[n]))/denom:0;}));
}
export function measureRisk(contracts,sigmas,matrix,metas){
 const v=contracts.map((q,j)=>q*sigmas[j]),groupRisk=indices=>Math.sqrt(Math.max(0,sum(indices.map(j=>sum(indices.map(k=>v[j]*v[k]*matrix[j][k]))))));
 return {total:groupRisk(v.map((_,j)=>j)),US:groupRisk(metas.flatMap((m,j)=>m.country==='US'?[j]:[])),DE:groupRisk(metas.flatMap((m,j)=>m.country==='DE'?[j]:[])),overlap:sum(v.map((x,j)=>['TY','UXY'].includes(metas[j].id)?Math.abs(x):0))};
}
function capTargets(raw,sigmas,matrix,metas,policy){
 const targets=[...raw],factors=raw.map(()=>1),flags=[];
 const scale=(indices,factor,flag)=>{if(factor<1-1e-12){indices.forEach(j=>{targets[j]*=factor;factors[j]*=factor;});flags.push(flag);}};
 const overlap=metas.flatMap((m,j)=>['TY','UXY'].includes(m.id)?[j]:[]),overlapRisk=sum(overlap.map(j=>Math.abs(targets[j]*sigmas[j])));
 if(overlapRisk>policy.overlapCap)scale(overlap,policy.overlapCap/overlapRisk,'TY/UXY');
 for(const country of ['US','DE']){const risk=measureRisk(targets,sigmas,matrix,metas)[country];if(risk>policy.countryCap)scale(metas.flatMap((m,j)=>m.country===country?[j]:[]),policy.countryCap/risk,country);}
 const risk=measureRisk(targets,sigmas,matrix,metas).total;
 if(risk>policy.portfolioCap)scale(targets.map((_,j)=>j),policy.portfolioCap/risk,'TOTAL');
 return {targets,factors,flags,risk:measureRisk(targets,sigmas,matrix,metas)};
}
// All quantities here use a USD 1 risk budget. Every cap and buffer scales linearly.
export function applyManagedStep({raw,sigmas,matrix,metas,policy,previous=null,buffered=true}){
 policy=normalizePolicy(policy);const capped=capTargets(raw,sigmas,matrix,metas,policy),old=previous?.targets||raw.map(()=>0),held=[];
 const beforeOverride=capped.targets.map((q,j)=>{
  const change=Math.abs(q-old[j])*sigmas[j];
  const defer=buffered&&policy.buffer>0&&change>1e-12&&Math.abs(q)>1e-14&&Math.abs(old[j])>1e-14&&sign(q)===sign(old[j])&&change<metas[j].risk_weight*policy.buffer;
  held[j]=defer;return defer?old[j]:q;
 });
 // Risk reduction takes precedence over a no-trade buffer, including after a vol jump.
 const enforced=capTargets(beforeOverride,sigmas,matrix,metas,policy),attribution=raw.map((q,j)=>{
  const oldRaw=previous?.raw[j]||0,oldSigma=previous?.sigmas[j]||sigmas[j],oldFactor=previous?.factors[j]??1;
  const signalRaw=q*sigmas[j]/oldSigma,signal=oldFactor*(signalRaw-oldRaw),volatility=oldFactor*(q-signalRaw);
  const override=enforced.targets[j]-beforeOverride[j],risk=(capped.factors[j]-oldFactor)*q+override;
  const band=beforeOverride[j]-capped.targets[j]+(previous?previous.capped[j]-old[j]:0);
  return {signal,volatility,risk,band,net:enforced.targets[j]-old[j],override,held:held[j]};
 });
 return {raw:[...raw],sigmas:[...sigmas],targets:enforced.targets,capped:capped.targets,factors:capped.factors,
  risk:enforced.risk,rawRisk:measureRisk(raw,sigmas,matrix,metas),flags:[...new Set([...capped.flags,...enforced.flags])],
  forced:enforced.flags.length>0,held,attribution};
}
export function managedTape(engine,input={}){
 const policy=normalizePolicy(input),key=JSON.stringify(policy);engine.managedCache??=new Map();if(engine.managedCache.has(key))return engine.managedCache.get(key);
 const metas=engine.instruments.map(i=>i.meta),dateMaps=engine.instruments.map(i=>new Map(i.frames.map(f=>[f.date,f]))),dates=[...new Set(dateMaps.flatMap(m=>[...m.keys()]))].sort();
 const frames=metas.map(()=>null),samples=[],entries=[],byDate=new Map();let matrix=null,previous=null,previousRisk=null;
 for(const date of dates){
  dateMaps.forEach((m,j)=>{if(m.has(date))frames[j]=m.get(date);});
  const common=frames.every(f=>f?.date===date&&finite(f.unitMove));
  if(common){samples.push(frames.map(f=>f.unitMove));if(samples.length>126)samples.shift();matrix=correlationFromSamples(samples,policy.shrinkage);}
  if(!matrix||!frames.every(f=>finite(f?.targets.MS)&&f.sigma>0))continue;
  const raw=frames.map(f=>f.targets.MS),sigmas=frames.map(f=>f.sigma);
  const fitd=applyManagedStep({raw,sigmas,matrix,metas,policy,previous,buffered:true}),risk=applyManagedStep({raw,sigmas,matrix,metas,policy,previous:previousRisk,buffered:false});
  const entry={date,fitd,risk,matrix,common,frames:[...frames]};entries.push(entry);byDate.set(date,entry);previous=fitd;previousRisk=risk;
 }
 const tape={policy,entries,byDate,dates:entries.map(e=>e.date),last:entries.at(-1),samples:samples.map(a=>[...a]),matrix,metas};engine.managedCache.set(key,tape);return tape;
}
function beforeDate(tape,date,inclusive=false){
 let lo=0,hi=tape.entries.length;while(lo<hi){const mid=(lo+hi)>>1;if(tape.entries[mid].date<date||(inclusive&&tape.entries[mid].date===date))lo=mid+1;else hi=mid;}return tape.entries[lo-1]||null;
}
function additionalPerformance(engine,tape,budget,costTicks){
 const ids=['MS_RISK','FITD','MS_CAP'],daily=new Map(),allAssets=Object.fromEntries(ids.map(id=>[id,{}]));let complete=true;
 for(let j=0;j<engine.instruments.length;j++){
  const {meta,frames}=engine.instruments[j],old=Object.fromEntries(ids.map(id=>[id,0]));let started=false;
  for(let k=1;k<frames.length;k++){
   const f=frames[k],row=meta.history[k];if(f.date<'2022-01-01')continue;
   const prior=beforeDate(tape,f.date),targets={MS_RISK:prior?.risk.targets[j],FITD:prior?.fitd.targets[j],MS_CAP:frames[k-1].targets.MS_CAP};
   if(!ids.every(id=>finite(targets[id]))){complete=false;continue;}
   const day=daily.get(f.date)||Object.fromEntries(ids.map(id=>[id,{gross:0,cost:0,net:0,turnover:0,assets:{}}]));
   for(const id of ids){const q=targets[id]*budget,delta=q-old[id],turnover=row[5]?Math.abs(old[id])+Math.abs(q):Math.abs(delta),gross=(old[id]*row[2]+q*row[3])*meta.point_value*row[6],cost=turnover*meta.tick_size*meta.point_value*row[6]*costTicks;
    day[id].gross+=gross;day[id].cost+=cost;day[id].net+=gross-cost;day[id].turnover+=turnover;
    day[id].assets[meta.id]={gross,cost,net:gross-cost,turnover,rolled:!!row[5],previous:old[id],applied:q,delta,closeContracts:row[5]?-old[id]:0,openContracts:row[5]?q:0};old[id]=q;
   }
   started=true;daily.set(f.date,day);
  }
  if(!started)complete=false;
 }
 const result={};for(const id of ids){let cumulative=0,peak=0,mdd=0,gross=0,cost=0,positive=0;const annual=new Map(),rows=[];
  for(const date of [...daily.keys()].sort()){const d=daily.get(date)[id],year=date.slice(0,4);cumulative+=d.net;peak=Math.max(peak,cumulative);mdd=Math.max(mdd,peak-cumulative);gross+=d.gross;cost+=d.cost;if(d.net>0)positive++;
   const y=annual.get(year)||{year,gross:0,cost:0,net:0,cumulative:0,peak:0,mdd:0,assets:{}};y.gross+=d.gross;y.cost+=d.cost;y.net+=d.net;y.cumulative+=d.net;y.peak=Math.max(y.peak,y.cumulative);y.mdd=Math.max(y.mdd,y.peak-y.cumulative);
   for(const [core,v]of Object.entries(d.assets)){y.assets[core]=(y.assets[core]||0)+v.net;allAssets[id][core]=(allAssets[id][core]||0)+v.net;}annual.set(year,y);rows.push({date,...d,cumulative,drawdown:peak-cumulative});
  }
  result[id]={available:complete,start:rows[0]?.date||null,end:rows.at(-1)?.date||null,gross,cost,net:gross-cost,mdd,positiveDays:positive,observations:rows.length,annual:[...annual.values()],daily:rows,assets:allAssets[id]};
 }return result;
}
export function performanceStress(perf,multiple=3,start='2022-01-01'){
 let cumulative=0,peak=0,mdd=0,cost=0;for(const d of perf.daily){if(d.date<start)continue;const c=d.cost*multiple;cost+=c;cumulative+=d.gross-c;peak=Math.max(peak,cumulative);mdd=Math.max(mdd,peak-cumulative);}return {net:cumulative,mdd,cost};
}
export function evaluate(engine,options={}){
 const {weights=[1,1,1],riskBudget=10000,costTicks=1,includePerformance=true,policy:input={}}=options,base=baseEvaluate(engine,{weights,riskBudget,costTicks,includePerformance}),tape=managedTape(engine,input),last=tape.last;
 if(!last)throw Error('MS 위험 관리 공통 관측이 부족합니다.');
 for(let j=0;j<base.rows.length;j++){
  const row=base.rows[j],instrument=engine.instruments[j],f=instrument.frames.at(-1),prev=instrument.frames.at(-2),prior=beforeDate(tape,f.date);
  row.models.MIX=row.models.FITD;row.models.MS_CAP={signal:f.signals.MS_CAP,band:f.bands.MS_CAP,current:prev.targets.MS_CAP*riskBudget,target:f.targets.MS_CAP*riskBudget,delta:(f.targets.MS_CAP-prev.targets.MS_CAP)*riskBudget,lastBandChange:f.lastBand.MS_CAP};
  for(const [id,field]of [['MS_RISK','risk'],['FITD','fitd']]){const current=prior?.[field].targets[j]??0,target=last[field].targets[j];row.models[id]={signal:f.signals.MS,band:f.bands.MS,current:current*riskBudget,target:target*riskBudget,delta:(target-current)*riskBudget,lastBandChange:f.lastBand.MS};}
  row.ms=f.ms;row.policy={held:last.fitd.held[j],factor:last.fitd.factors[j],forced:last.fitd.forced};
  // A closed market may have several unexecuted policy revisions since its last
  // observed open. Accumulate those revisions instead of comparing to a fictitious fill.
  const changes=tape.entries.filter(e=>!prior||e.date>prior.date).map(e=>e.fitd.attribution[j]);
  row.attribution=Object.fromEntries(['signal','volatility','risk','band','net','override'].map(k=>[k,sum(changes.map(a=>a[k]))*riskBudget]));
  row.attribution.held=last.fitd.held[j];row.attribution.from=prior?.date||null;row.attribution.through=last.date;
  row.estimatedDV01=finite(row.sensitivity)?row.sensitivity*row.models.FITD.current:null;
 }
 base.totals.MIX=base.totals.FITD;
 for(const id of ['MS_RISK','FITD','MS_CAP']){
  const qs=base.rows.map(r=>r.models[id].target),sigmas=last.frames.map(f=>f.sigma),risk=measureRisk(qs,sigmas,last.matrix,tape.metas);
  base.totals[id]={longs:qs.filter(q=>q>1e-10).length,shorts:qs.filter(q=>q< -1e-10).length,neutral:qs.filter(q=>Math.abs(q)<=1e-10).length,riskUsed:sum(qs.map((q,j)=>Math.abs(q*sigmas[j]))),estimatedDailyRisk:risk.total,countryRisk:{US:risk.US,DE:risk.DE},overlapRisk:risk.overlap,
   estimatedDV01:base.rows.every(r=>finite(r.sensitivity))?sum(base.rows.map(r=>r.sensitivity*r.models[id].current)):null,nextEstimatedDV01:base.rows.every(r=>finite(r.sensitivity))?sum(base.rows.map(r=>r.sensitivity*r.models[id].target)):null};
 }
 if(includePerformance){base.performance.MIX=base.performance.FITD;Object.assign(base.performance,additionalPerformance(engine,tape,riskBudget,costTicks));}
 const entries=tape.entries.filter(e=>e.date>='2022-01-01');
 base.policy=tape.policy;base.policyStats={observations:entries.length,riskDays:entries.filter(e=>e.fitd.flags.length).length,bufferDays:entries.filter(e=>e.fitd.held.some(Boolean)).length,forcedDays:entries.filter(e=>e.fitd.forced).length,legDeferrals:sum(entries.map(e=>e.fitd.held.filter(Boolean).length)),commonObservations:tape.samples.length,decisionDate:last.date};
 base.risk={current:Object.fromEntries(Object.entries(last.fitd.risk).map(([k,v])=>[k,v*riskBudget])),raw:Object.fromEntries(Object.entries(last.fitd.rawRisk).map(([k,v])=>[k,v*riskBudget])),flags:last.fitd.flags};
 return base;
}
export function managedHistory(engine,core,model='FITD',policy={},budget=10000){
 const tape=managedTape(engine,policy),j=tape.metas.findIndex(m=>m.id===core),field=model==='MS_RISK'?'risk':'fitd';if(j<0)return [];
 return tape.entries.map((e,k)=>({date:e.date,target:e[field].targets[j]*budget,current:k?tape.entries[k-1][field].targets[j]*budget:0}));
}
export function scenario(engine,options={}){
 const {policy:input={},...settings}=options,policy=normalizePolicy(input),paths=baseScenario(engine,settings),tape=managedTape(engine,policy),last=tape.last,budget=settings.riskBudget??10000;
 if(!last||paths.some(p=>!p.available))return paths.map(p=>({...p,available:false,reason:p.reason||'9상품 공동 위험 경로 준비 필요'}));
 let previous=last.fitd,previousRisk=last.risk,matrix=last.matrix;const samples=tape.samples.map(a=>[...a]);
 const current=tape.metas.map((m,j)=>{const f=engine.instruments[j].frames.at(-1),prior=beforeDate(tape,f.date);return {FITD:(prior?.fitd.targets[j]??0),MS_RISK:(prior?.risk.targets[j]??0)};});
 for(let j=0;j<paths.length;j++){paths[j].current.MIX=paths[j].current.FITD;paths[j].knownNext.MIX=paths[j].knownNext.FITD;for(const [id,field]of [['FITD','fitd'],['MS_RISK','risk']]){paths[j].current[id]=current[j][id]*budget;paths[j].knownNext[id]=last[field].targets[j]*budget;}}
 for(let k=0;k<paths[0].path.length;k++){
  const frames=paths.map(p=>p.path[k].frame),sigmas=frames.map(f=>f.sigma),raw=frames.map(f=>f.targets.MS);
  if(!settings.freezeVol){samples.push(frames.map(f=>f.unitMove));if(samples.length>126)samples.shift();matrix=correlationFromSamples(samples,policy.shrinkage)||matrix;}
  const fitd=applyManagedStep({raw,sigmas,matrix,metas:tape.metas,policy,previous,buffered:true}),risk=applyManagedStep({raw,sigmas,matrix,metas:tape.metas,policy,previous:previousRisk,buffered:false});
  for(let j=0;j<paths.length;j++)for(const [id,field,old]of [['FITD',fitd,previous],['MS_RISK',risk,previousRisk]]){
   const applied=old.targets[j]*budget,closeTarget=field.targets[j]*budget,priorApplied=k?paths[j].path[k-1].models[id].applied:current[j][id]*budget;
   paths[j].path[k].models[id]={applied,closeTarget,openTrade:applied-priorApplied,deltaFromCurrent:closeTarget-current[j][id]*budget,nextTrade:closeTarget-applied,signal:frames[j].signals.MS,
    attribution:Object.fromEntries(Object.entries(field.attribution[j]).map(([name,v])=>[name,typeof v==='number'?v*budget:v]))};
  }previous=fitd;previousRisk=risk;
 }return paths;
}
export function nearestPortfolioTurn(engine,core,options={}){
 const instrument=engine.instruments.find(i=>i.meta.id===core);if(!instrument?.meta.sensitivity?.available)return {available:false,reason:'금리 민감도 미확정'};
 const run=move=>scenario(engine,{...options,steps:1,move,unit:'bp',shape:'jump',instrumentOnly:core}).find(p=>p.id===core),model=options.model||'FITD',base=run(0);
 if(!base?.available)return {available:false,reason:base?.reason||'공동 경로 준비 필요'};
 const direction=sign(base.path[0].models[model].closeTarget),hits=[];
 for(const d of [-1,1])for(let m=1;m<=50;m++){const p=run(m*d),target=p.path[0].models[model].closeTarget;if(sign(target)!==direction){hits.push({moveBp:m*d,target,side:sign(target)});break;}}
 return {available:true,baselineSide:direction,hits,rangeBp:50,precisionBp:1};
}
export {baseEvaluate as evaluateBaseline};
