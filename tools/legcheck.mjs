import fs from "fs"; import vm from "vm";
const sb = {};
vm.runInNewContext(fs.readFileSync("js/data.js","utf8")+"\nglobalThis.P=PLACES;globalThis.C=COORDS;globalThis.D=DAYS;", sb);
const hav=(a,b)=>{const R=6371,r=x=>x*Math.PI/180;const dLa=r(b[0]-a[0]),dLo=r(b[1]-a[1]);return 2*R*Math.asin(Math.sqrt(Math.sin(dLa/2)**2+Math.cos(r(a[0]))*Math.cos(r(b[0]))*Math.sin(dLo/2)**2));};
for (const d of sb.D) {
  const pts = d.stops.map(id=>({id,ll:sb.C[id]})).filter(x=>x.ll);
  for (let i=1;i<pts.length;i++){
    const km = hav(pts[i-1].ll, pts[i].ll);
    const transit = ["transit"].includes(sb.P[pts[i].id]?.cat) || ["transit"].includes(sb.P[pts[i-1].id]?.cat);
    if (km > 8 && !transit) console.log(`${d.id} | ${pts[i-1].id} -> ${pts[i].id} | ${km.toFixed(1)}km  <<< SUSPICIOUS`);
  }
}
console.log("leg check done");
