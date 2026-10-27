// Client-only CSV parser. No persistence: sensitive applicant details remain in memory.
export const GROUP_HEADERS=Object.freeze([
 'fullName','dateOfBirth','gender','phone','subCounty','schoolOrCollege','sports',
 'nextOfKinName','nextOfKinRelationship','nextOfKinPhone','guardianName','guardianRelationship','guardianPhone'
]);
export const GROUP_LIMIT=20;

export function parseCsv(text) {
 if(typeof text!=='string'||text.length>50000) throw Error('Paste a CSV of 50 KB or less.');
 const input=text.replace(/^\uFEFF/,'');
 let rows=[],line=[],cell='',quoted=false;
 for(let i=0;i<input.length;i++){
   const c=input[i];
   if(quoted){
     if(c==='"'&&input[i+1]==='"'){cell+='"';i++;}
     else if(c==='"') quoted=false;
     else cell+=c;
   } else if(c==='"' && cell===''){quoted=true;}
   else if(c===','){line.push(cell);cell='';}
   else if(c==='\n'||c==='\r'){
     if(c==='\r'&&input[i+1]==='\n')i++;
     line.push(cell);if(line.some(x=>x.trim()))rows.push(line);
     line=[];cell='';
   } else {cell+=c;}
 }
 if(quoted)throw Error('A CSV field has an unclosed quote.');
 line.push(cell);if(line.some(x=>x.trim()))rows.push(line);
 if(!rows.length)throw Error('The CSV is empty.');
 return rows;
}
export function prepareGroupCsv(text,sports) {
 const [headers,...rows]=parseCsv(text);
 if(headers.length!==GROUP_HEADERS.length||!GROUP_HEADERS.every((h,i)=>headers[i]?.trim()===h))
   throw Error(`The CSV must begin with this exact header: ${GROUP_HEADERS.join(',')}`);
 if(!rows.length||rows.length>GROUP_LIMIT)throw Error(`Include 1–${GROUP_LIMIT} member rows.`);
 const sportMap=new Map((sports||[]).map(s=>[s.name.trim().toLowerCase(),String(s.id)]));
 const seen=new Set();
 const members=rows.map((values,i)=>{
   if(values.length!==GROUP_HEADERS.length)throw Error(`Row ${i+2}: expected ${GROUP_HEADERS.length} columns, got ${values.length}.`);
   const v=Object.fromEntries(GROUP_HEADERS.map((h,j)=>[h,values[j].trim()]));
   if(!v.fullName||!v.dateOfBirth||!v.subCounty||!v.nextOfKinName||!v.nextOfKinRelationship||!v.nextOfKinPhone)
     throw Error(`Row ${i+2}: required member or next-of-kin details are missing.`);
   if(!/^\d{4}-\d{2}-\d{2}$/.test(v.dateOfBirth))throw Error(`Row ${i+2}: use YYYY-MM-DD for date of birth.`);
   const today=new Intl.DateTimeFormat('sv-SE',{timeZone:'Africa/Nairobi',year:'numeric',month:'2-digit',day:'2-digit'}).format(new Date());
   const [y,mo,d]=v.dateOfBirth.split('-').map(Number), [Y,M,D]=today.split('-').map(Number);
   const validDate=new Date(`${v.dateOfBirth}T00:00:00Z`);
   if(Number.isNaN(validDate.valueOf())||validDate.toISOString().slice(0,10)!==v.dateOfBirth)throw Error(`Row ${i+2}: invalid calendar date.`);
   const age=Y-y-(M<mo||(M===mo&&D<d)?1:0);
   if(age<12||age>35)throw Error(`Row ${i+2}: age must be between 12 and 35.`);
   const uniqueKey=`${v.fullName.trim().toLowerCase()}|${v.dateOfBirth}`;
   if(seen.has(uniqueKey))throw Error(`Row ${i+2}: duplicate name and birth date in this intake.`);
   seen.add(uniqueKey);
   const names=v.sports.split('|').map(n=>n.trim().toLowerCase());
   const sportIds=names.map(name=>sportMap.get(name));
   if(!sportIds.length||sportIds.some(id=>!id)||new Set(sportIds).size!==sportIds.length)
     throw Error(`Row ${i+2}: choose known, distinct sports separated by | (for example Football|Chess).`);
   const member={fullName:v.fullName,dateOfBirth:v.dateOfBirth,subCounty:v.subCounty,
     sportIds,nextOfKin:{fullName:v.nextOfKinName,relationship:v.nextOfKinRelationship,phone:v.nextOfKinPhone}};
   if(v.gender)member.gender=v.gender;
   if(v.phone)member.phone=v.phone;
   if(v.schoolOrCollege)member.schoolOrCollege=v.schoolOrCollege;
   const guardianParts=[v.guardianName,v.guardianRelationship,v.guardianPhone];
   if(guardianParts.some(Boolean)){
     if(!guardianParts.every(Boolean))throw Error(`Row ${i+2}: complete all guardian fields or leave all blank.`);
     member.guardian={fullName:v.guardianName,relationship:v.guardianRelationship,phone:v.guardianPhone};
   }
   if(age<18&&!member.guardian)throw Error(`Row ${i+2}: guardian name, relationship and phone required for a minor.`);
   if(age>=18&&member.guardian)throw Error(`Row ${i+2}: adults should leave guardian columns empty.`);
   return member;
 });
 return members;
}
