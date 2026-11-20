export const PAIR_SORTS=[['priority','모델 추천순'],['abs_z','|Z-score| 크기'],['oos_z','Z-score (부호)'],['abs_beta','|진입 β| 크기'],['lag_beta','진입 β (부호)'],['quality','품질 Q'],['name','페어명']];
export function sortPairs(rows,key='priority',direction='desc'){
 if(key==='priority'||!PAIR_SORTS.some(([k])=>k===key))return [...rows];
 const ascending=direction==='asc';
 const value=r=>key==='name'?r.name:key==='abs_z'?(r.oos_z==null?null:Math.abs(r.oos_z)):key==='abs_beta'?(r.lag_beta==null?null:Math.abs(r.lag_beta)):r[key];
 return [...rows].sort((a,b)=>{const av=value(a),bv=value(b),valid=v=>key==='name'?typeof v==='string':typeof v==='number'&&Number.isFinite(v),va=valid(av),vb=valid(bv);
  if(va!==vb)return va?-1:1;
  const order=!va?0:key==='name'?av.localeCompare(bv,'ko'):av-bv;
  return (ascending?order:-order)||String(a.id).localeCompare(String(b.id));
 });
}
