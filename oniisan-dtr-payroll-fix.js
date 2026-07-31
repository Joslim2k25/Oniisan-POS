// ══════════════════════════════════════════════════════════════════
// ONIISAN POS — DTR / PAYROLL DAYS-WORKED FIX
// ══════════════════════════════════════════════════════════════════
// PROBLEM FIXED:
// "Days Worked" (sa DTR tab at sa Payroll computation) ay hindi
// binibilang kung ang empleyado ay may TIME IN pero walang TIME OUT
// record (hal. nakalimutang mag-punch out). Dati, kailangan pareho
// TIME IN at TIME OUT bago mabilang bilang 1 araw — kahit totoong
// pumasok naman ang empleyado.
//
// FIX: Ngayon, kahit "IN" record lang (walang OUT), binibilang na
// bilang 1 present day. OT Hours computation ay HINDI nagbago —
// kailangan pa rin ng approval (ots.find(...)), gaya ng dati.
//
// PAANO GAMITIN:
// 1. I-upload itong file (oniisan-dtr-payroll-fix.js) sa parehong
//    GitHub repo/folder kung nasaan ang main index.html mo.
// 2. Sa loob ng index.html, hanapin ang linyang:
//        </script>
//        </body>
//    (ang pinakahuling </script> bago ang </body>)
// 3. Idagdag itong isang linya sa ITAAS ng </body>, PAGKATAPOS ng
//    huling </script>:
//        <script src="oniisan-dtr-payroll-fix.js"></script>
// 4. I-commit at i-deploy. Tapos na — hindi mo na kailangang hawakan
//    o baguhin ang laman ng malaking index.html file mo.
// ══════════════════════════════════════════════════════════════════

(function(){

  // ── Wait until the main app's functions exist before patching ──
  function whenReady(cb){
    if(typeof window.renderDTR==='function' && typeof window.computePayroll==='function' && typeof window.sb!=='undefined'){
      cb();
    } else {
      setTimeout(()=>whenReady(cb),100);
    }
  }

  whenReady(function(){

    // ══════ PATCHED DTR RENDERER ══════
    // Identical to the original renderDTR, except the "IN only, no OUT"
    // branch now also increments daysWorked.
    window.renderDTR = async function renderDTR(dateKey){
      const dk=dateKey||getTodayKey();
      document.getElementById('adminBody').innerHTML='<div style="text-align:center;padding:40px;color:#ccc">Loading DTR...</div>';
      const d=new Date(dk+'T12:00:00');
      const year=d.getFullYear();
      const month=d.getMonth()+1;
      const day=d.getDate();
      const pad=n=>String(n).padStart(2,'0');
      let cutoffStart,cutoffEnd,cutoffLabel;
      if(day>=26){
        cutoffStart=`${year}-${pad(month)}-26`;
        const nextMonth=month===12?1:month+1;
        const nextYear=month===12?year+1:year;
        cutoffEnd=`${nextYear}-${pad(nextMonth)}-10`;
        cutoffLabel=`${pad(month)}/26/${year} - ${pad(nextMonth)}/10/${nextYear}`;
      } else if(day<=10){
        const prevMonth=month===1?12:month-1;
        const prevYear=month===1?year-1:year;
        cutoffStart=`${prevYear}-${pad(prevMonth)}-26`;
        cutoffEnd=`${year}-${pad(month)}-10`;
        cutoffLabel=`${pad(prevMonth)}/26/${prevYear} - ${pad(month)}/10/${year}`;
      } else {
        cutoffStart=`${year}-${pad(month)}-11`;
        cutoffEnd=`${year}-${pad(month)}-25`;
        cutoffLabel=`${pad(month)}/11/${year} - ${pad(month)}/25/${year}`;
      }
      const dates=[];
      let cur=new Date(cutoffStart+'T12:00:00');
      const endDate=new Date(cutoffEnd+'T12:00:00');
      while(cur<=endDate){dates.push(cur.toISOString().slice(0,10));cur.setDate(cur.getDate()+1);}
      const{data:records}=await sb.from('time_records').select('*').gte('ts',cutoffStart+'T00:00:00.000Z').lte('ts',cutoffEnd+'T23:59:59.999Z').order('ts');
      const{data:holidays}=await sb.from('holidays').select('*');
      const recs=records||[];
      const holidayMap={};
      (holidays||[]).forEach(h=>{holidayMap[h.date_key]=h;});
      const empDayMap={};
      recs.forEach(r=>{
        const empId=r.emp_id;const dayKey=r.ts.slice(0,10);
        if(!empDayMap[empId]){empDayMap[empId]={name:r.emp_name,days:{}};}
        if(!empDayMap[empId].days[dayKey])empDayMap[empId].days[dayKey]=[];
        empDayMap[empId].days[dayKey].push(r);
      });
      window.__dtrEmpDayMap=empDayMap;
      const periods=[];
      for(let y=2025;y<=2027;y++){
        for(let m=1;m<=12;m++){
          const pm=m===1?12:m-1;const py=m===1?y-1:y;
          periods.push({val:`${py}-${pad(pm)}-26`,label:`${pad(pm)}/26/${py} - ${pad(m)}/10/${y}`,dk:`${py}-${pad(pm)}-26`});
          periods.push({val:`${y}-${pad(m)}-11`,label:`${pad(m)}/11/${y} - ${pad(m)}/25/${y}`,dk:`${y}-${pad(m)}-11`});
        }
      }
      const dayHeaders=dates.map(dt=>{
        const d=new Date(dt+'T12:00:00');
        const dayNames=['S','M','T','W','T','F','S'];
        const isHoliday=!!holidayMap[dt];const isSunday=d.getDay()===0;
        const bg=isHoliday?'#fef9e7':isSunday?'#fff5f5':'transparent';
        return `<th style="padding:6px 4px;text-align:center;min-width:56px;background:${bg};white-space:nowrap;font-size:10px;border-right:1px solid #e0e0e0">
          <div style="font-weight:800;color:${isSunday?'var(--red)':isHoliday?'var(--gold)':'var(--muted)'}">${dayNames[d.getDay()]}</div>
          <div style="font-weight:700;color:${isSunday?'var(--red)':isHoliday?'var(--gold)':'#333'}">${d.getDate()}</div>
        </th>`;
      }).join('');
      const fmtPunchTime=ts=>new Date(ts).toLocaleTimeString('en-PH',{hour:'numeric',minute:'2-digit'}).replace(' ','').toLowerCase();
      const empRows=employees.map(emp=>{
        const empData=empDayMap[emp.id]||{days:{}};
        let totalHours=0;let daysWorked=0;
        const dayCells=dates.map(dt=>{
          const dayRecs=empData.days[dt]||[];
          const outRec=dayRecs.find(r=>r.action==='out');
          const inRec=dayRecs.find(r=>r.action==='in');
          const isHoliday=!!holidayMap[dt];const isSunday=new Date(dt+'T12:00:00').getDay()===0;
          const bg=isHoliday?'#fef9e7':isSunday?'#fff5f5':'transparent';
          const isManual=outRec&&outRec.photo_url==='MANUAL_ENTRY';
          const clickAttr=dayRecs.length?` onclick="showDtrDayDetail('${emp.id}','${dt}')"`:'';
          const clickStyle=dayRecs.length?'cursor:pointer;':'';
          if(outRec&&inRec){
            const inTime=new Date(inRec.ts).getTime();
            const outTime=new Date(outRec.ts).getTime();
            const hrs=Math.min(Math.max(0,(outTime-inTime)/3600000),16);
            totalHours+=hrs;daysWorked++;
            const color=hrs>=8?'var(--green)':hrs>=4?'var(--gold)':'var(--red)';
            const manualMark=isManual?`<span style="color:var(--red);font-size:9px;font-weight:900">*</span>`:'';
            return `<td${clickAttr} style="padding:4px 2px;text-align:center;background:${bg};border-right:1px solid #f0f0f0;${clickStyle}">
              <div style="font-size:11px;font-weight:700;color:${color}">${hrs.toFixed(1)}h${manualMark}</div>
              <div style="font-size:8.5px;font-weight:700;color:var(--green);line-height:1.3">↓${fmtPunchTime(inRec.ts)}</div>
              <div style="font-size:8.5px;font-weight:700;color:var(--red);line-height:1.3">↑${fmtPunchTime(outRec.ts)}</div>
            </td>`;
          } else if(inRec){
            // ★ FIX: kahit walang OUT, binibilang na bilang present day ★
            daysWorked++;
            return `<td${clickAttr} style="padding:4px 2px;text-align:center;background:${bg};border-right:1px solid #f0f0f0;${clickStyle}">
              <div style="font-size:11px;font-weight:800;color:var(--blue)">IN</div>
              <div style="font-size:8.5px;font-weight:700;color:var(--green);line-height:1.3">↓${fmtPunchTime(inRec.ts)}</div>
            </td>`;
          } else {
            return `<td style="padding:4px 2px;text-align:center;background:${bg};border-right:1px solid #f0f0f0;font-size:11px;color:#ddd">—</td>`;
          }
        }).join('');
        const initials=emp.initials||emp.name.split(' ').map(w=>w[0]).join('').slice(0,2).toUpperCase();
        return `<tr>
          <td style="padding:8px 10px;font-weight:700;white-space:nowrap;border-right:2px solid var(--border);position:sticky;left:0;background:#fff;z-index:1">
            <div style="display:flex;align-items:center;gap:6px">
              <div style="width:28px;height:28px;border-radius:50%;background:${emp.role==='owner'?'#c8900a':emp.role==='admin'?'#1a5fa8':'#555'};color:#fff;display:flex;align-items:center;justify-content:center;font-size:10px;font-weight:800;flex-shrink:0">${initials}</div>
              <div><div style="font-size:12px">${emp.name}</div><div style="font-size:9px;color:var(--muted);text-transform:uppercase">${emp.role}</div></div>
            </div>
          </td>
          ${dayCells}
          <td style="padding:6px 8px;text-align:center;border-left:2px solid var(--border);font-weight:800;color:var(--green);font-size:13px">${daysWorked}</td>
          <td style="padding:6px 8px;text-align:center;font-weight:900;color:var(--blue);font-size:13px">${totalHours.toFixed(1)}</td>
        </tr>`;
      }).join('');
      // ★ FIX: compute grand totals across all employees for the summary row ★
      let grandTotalDays=0, grandTotalHours=0;
      employees.forEach(emp=>{
        const empData=empDayMap[emp.id]||{days:{}};
        Object.keys(empData.days).forEach(dt=>{
          const dayRecs=empData.days[dt]||[];
          const outRec=dayRecs.find(r=>r.action==='out');
          const inRec=dayRecs.find(r=>r.action==='in');
          if(outRec&&inRec){
            const hrs=Math.min(Math.max(0,(new Date(outRec.ts).getTime()-new Date(inRec.ts).getTime())/3600000),16);
            grandTotalDays++; grandTotalHours+=hrs;
          } else if(inRec){
            grandTotalDays++;
          }
        });
      });

      document.getElementById('adminBody').innerHTML=`
      <div style="display:flex;align-items:center;gap:8px;margin-bottom:14px;flex-wrap:wrap">
        <div style="font-size:15px;font-weight:800;display:flex;align-items:center;gap:8px;flex:1"><div class="red-bar"></div>DTR — ${cutoffLabel}</div>
        <select class="inp" style="width:220px" onchange="renderDTR(this.value)">
          ${periods.map(p=>`<option value="${p.dk}"${p.dk===cutoffStart?' selected':''}>${p.label}</option>`).join('')}
        </select>
        <button onclick="window.print()" style="padding:8px 14px;background:#1a5fa8;color:#fff;border:none;border-radius:8px;font-size:12px;font-weight:700;cursor:pointer">🖨️ Print DTR</button>
      </div>
      <div style="font-size:11px;color:var(--muted);margin-bottom:8px;display:flex;gap:16px;flex-wrap:wrap">
        <span style="color:var(--green);font-weight:700">■ Green = 8+ hrs</span>
        <span style="color:var(--gold);font-weight:700">■ Gold = 4-8 hrs</span>
        <span style="color:var(--red);font-weight:700">■ Red = under 4 hrs</span>
        <span style="background:#fef9e7;padding:0 6px;border-radius:4px;font-weight:700;color:var(--gold)">Holiday</span>
        <span style="background:#fff5f5;padding:0 6px;border-radius:4px;font-weight:700;color:var(--red)">Sunday</span>
        <span><span style="color:var(--green);font-weight:700">↓ Time In</span> · <span style="color:var(--red);font-weight:700">↑ Time Out</span> — click a cell for the full punch log (incl. breaks)</span>
      </div>
      <div style="background:var(--red);color:#fff;border-radius:10px;padding:12px 16px;margin-bottom:12px;display:flex;justify-content:space-between;align-items:center;flex-wrap:wrap;gap:8px">
        <div style="font-size:12px;font-weight:800;letter-spacing:.5px">TOTAL — LAHAT NG EMPLEYADO (${cutoffLabel})</div>
        <div style="display:flex;gap:20px">
          <div style="text-align:center"><div style="font-size:20px;font-weight:900">${grandTotalDays}</div><div style="font-size:10px;opacity:.85">Total Days Worked</div></div>
          <div style="text-align:center"><div style="font-size:20px;font-weight:900">${grandTotalHours.toFixed(1)}</div><div style="font-size:10px;opacity:.85">Total Hours</div></div>
        </div>
      </div>
      <div style="overflow-x:auto;border-radius:10px;border:1px solid var(--border)">
        <table style="border-collapse:collapse;font-size:12px;width:100%">
          <thead>
            <tr style="background:#f8f8f8">
              <th style="padding:10px;text-align:left;border-right:2px solid var(--border);position:sticky;left:0;background:#f8f8f8;z-index:2;min-width:150px">Employee</th>
              ${dayHeaders}
              <th style="padding:6px 8px;text-align:center;border-left:2px solid var(--border);background:#eafaf1;color:var(--green);font-size:11px;min-width:45px">Days</th>
              <th style="padding:6px 8px;text-align:center;background:#eaf2fb;color:var(--blue);font-size:11px;min-width:50px">Total Hrs</th>
            </tr>
          </thead>
          <tbody>${empRows||'<tr><td colspan="100" style="text-align:center;padding:30px;color:#ccc">No records for this period</td></tr>'}</tbody>
          <tfoot>
            <tr style="background:#1a1a2e;color:#fff;font-weight:900">
              <td style="padding:8px 10px;position:sticky;left:0;background:#1a1a2e" colspan="${dates.length+1}">GRAND TOTAL</td>
              <td style="padding:8px;text-align:center;border-left:2px solid #333;color:#4ade80">${grandTotalDays}</td>
              <td style="padding:8px;text-align:center;color:#60a5fa">${grandTotalHours.toFixed(1)}</td>
            </tr>
          </tfoot>
        </table>
      </div>`;
    };

    // ══════ PATCHED PAYROLL COMPUTATION ══════
    // Identical to the original computePayroll, except a day counts as
    // worked based on the IN record, not on requiring an OUT record.
    // OT hours still require separate approval (unchanged).
    window.computePayroll = async function computePayroll(start,end){
      setLoading(true);
      document.getElementById('payrollTable').innerHTML='<div style="text-align:center;padding:20px;color:#ccc">Computing...</div>';
      const{data:records}=await sb.from('time_records').select('*').gte('ts',start+'T00:00:00.000Z').lte('ts',end+'T23:59:59.999Z').order('ts');
      const{data:holidays}=await sb.from('holidays').select('*');
      const{data:otApprovals}=await sb.from('ot_approvals').select('*').eq('status','approved').gte('date_key',start).lte('date_key',end);
      const recs=records||[];const hols=holidays||[];const ots=otApprovals||[];
      const holidayMap={};hols.forEach(h=>{holidayMap[h.date_key]=h;});
      const empMap={};
      recs.forEach(r=>{if(!empMap[r.emp_id]){empMap[r.emp_id]={name:r.emp_name,records:[]};}empMap[r.emp_id].records.push(r);});
      const payrollRows=[];
      for(const empId of Object.keys(empMap)){
        const emp=empMap[empId];
        const dayMap={};
        emp.records.forEach(r=>{const dk=r.ts.slice(0,10);if(!dayMap[dk])dayMap[dk]=[];dayMap[dk].push(r);});
        let daysWorked=0,totalHours=0,otHours=0,holidayPay=0;
        Object.keys(dayMap).forEach(dk=>{
          const outRec=dayMap[dk].find(r=>r.action==='out');
          const inRec=dayMap[dk].find(r=>r.action==='in');
          // ★ FIX: dating "if(!outRec)return;" — hindi na kailangan ng OUT
          // para mabilang bilang present day. Basta may IN, present. ★
          if(!inRec)return;
          daysWorked++;
          if(outRec){
            totalHours+=(outRec.total_work||0)/3600000;
          }
          // OT approval logic — HINDI NAGBAGO, kailangan pa rin ng approval
          const approvedOT=ots.find(o=>o.emp_id===empId&&o.date_key===dk);
          if(approvedOT)otHours+=approvedOT.ot_hours;
          if(holidayMap[dk]){
            const h=holidayMap[dk];
            holidayPay+=h.type==='regular'?DAILY_RATE:DAILY_RATE*0.30;
          }
        });
        const basicPay=daysWorked*DAILY_RATE;
        const otPay=otHours*OT_RATE;
        const grossPay=basicPay+otPay+holidayPay;
        const isDeductionPeriod=new Date(end).getDate()>=25;
        const totalDed=isDeductionPeriod?TOTAL_DEDUCTIONS:0;
        const netPay=grossPay-totalDed;
        payrollRows.push({empId,name:emp.name,daysWorked,totalHours:totalHours.toFixed(1),otHours:otHours.toFixed(1),basicPay,otPay,holidayPay,grossPay,totalDed,netPay});
      }
      setLoading(false);
      if(!payrollRows.length){document.getElementById('payrollTable').innerHTML='<div class="card" style="text-align:center;padding:30px;color:#ccc">No time records found for this period</div>';return;}
      const totalGross=payrollRows.reduce((s,r)=>s+r.grossPay,0);
      const totalNet=payrollRows.reduce((s,r)=>s+r.netPay,0);
      document.getElementById('payrollTable').innerHTML=`
      <div class="card">
        <div class="card-title"><div class="red-bar"></div>Payroll — ${start} to ${end}</div>
        <div style="overflow-x:auto">
        <table class="tbl">
          <thead><tr><th>Employee</th><th class="num">Days</th><th class="num">Hrs</th><th class="num">OT Hrs</th><th class="num">Basic</th><th class="num">OT Pay</th><th class="num">Holiday</th><th class="num">Gross</th><th class="num">Deductions</th><th class="num">NET PAY</th><th>Payslip</th></tr></thead>
          <tbody>
            ${payrollRows.map(r=>`<tr>
              <td style="font-weight:700">${r.name}</td>
              <td class="num">${r.daysWorked}</td>
              <td class="num">${r.totalHours}</td>
              <td class="num">${+r.otHours>0?`<span style="color:var(--gold);font-weight:700">${r.otHours}</span>`:'—'}</td>
              <td class="num">${fmt(r.basicPay)}</td>
              <td class="num">${r.otPay>0?`<span style="color:var(--gold)">${fmt(r.otPay)}</span>`:'—'}</td>
              <td class="num">${r.holidayPay>0?`<span style="color:var(--blue)">${fmt(r.holidayPay)}</span>`:'—'}</td>
              <td class="num gr" style="font-weight:800">${fmt(r.grossPay)}</td>
              <td class="num re">${r.totalDed>0?'-'+fmt(r.totalDed):'—'}</td>
              <td class="num" style="font-weight:900;color:var(--green);font-size:14px">${fmt(r.netPay)}</td>
              <td><button onclick="showPayslip('${r.name}',${r.daysWorked},${r.totalHours},${r.otHours},${r.basicPay},${r.otPay},${r.holidayPay},${r.grossPay},${r.totalDed},${r.netPay},'${start}','${end}')" style="padding:4px 10px;background:var(--blue-light);color:var(--blue);border:1px solid #a9cce3;border-radius:6px;font-size:11px;font-weight:700;cursor:pointer">📄 Payslip</button></td>
            </tr>`).join('')}
          </tbody>
          <tfoot><tr style="background:#f0f0f0;font-weight:900">
            <td colspan="7">TOTAL</td>
            <td class="num gr">${fmt(totalGross)}</td>
            <td class="num re">-${fmt(payrollRows.reduce((s,r)=>s+r.totalDed,0))}</td>
            <td class="num" style="color:var(--green)">${fmt(totalNet)}</td>
            <td></td>
          </tr></tfoot>
        </table></div>
      </div>`;
      for(const r of payrollRows){
        const{data:ex}=await sb.from('payroll').select('id').eq('emp_id',r.empId).eq('cutoff_start',start).eq('cutoff_end',end).limit(1);
        const rec={emp_id:r.empId,emp_name:r.name,cutoff_start:start,cutoff_end:end,days_worked:r.daysWorked,total_hours:+r.totalHours,ot_hours:+r.otHours,ot_pay:r.otPay,holiday_pay:r.holidayPay,basic_pay:r.basicPay,gross_pay:r.grossPay,sss:r.totalDed>0?450:0,philhealth:r.totalDed>0?200:0,pagibig:r.totalDed>0?200:0,total_deductions:r.totalDed,net_pay:r.netPay,branch:'SM Bicutan'};
        if(ex&&ex.length){await sb.from('payroll').update(rec).eq('id',ex[0].id);}
        else{await sb.from('payroll').insert([rec]);}
      }
      showToast('Payroll computed and saved!');
    };

    // ══════ NEW: AUTO-FILL DAYS WORKED IN MANUAL PAYROLL ENTRY ══════
    // Adds data-id to each option in the Manual Payroll dropdown and an
    // onchange handler that pulls the correct auto-computed day count
    // (same fixed logic as above) into the "Days Worked" field.
    window.autoFillManualPayrollDays = async function autoFillManualPayrollDays(start,end){
      const sel=document.getElementById('manualPayrollEmpSel');
      if(!sel)return;
      const opt=sel.options[sel.selectedIndex];
      const empId=opt?.dataset?.id;
      if(!empId)return;
      const daysInput=document.getElementById('manualPayrollDays');
      if(daysInput)daysInput.value='...';
      const{data:records}=await sb.from('time_records').select('*').eq('emp_id',empId).gte('ts',start+'T00:00:00.000Z').lte('ts',end+'T23:59:59.999Z').order('ts');
      const recs=records||[];
      const dayMap={};
      recs.forEach(r=>{const dk=r.ts.slice(0,10);if(!dayMap[dk])dayMap[dk]=[];dayMap[dk].push(r);});
      let daysWorked=0;
      Object.keys(dayMap).forEach(dk=>{
        const inRec=dayMap[dk].find(r=>r.action==='in');
        if(inRec)daysWorked++;
      });
      if(daysInput)daysInput.value=daysWorked;
      showToast(`Auto-filled: ${daysWorked} days (base sa Time Records)`);
    };

    // Re-attach data-id + onchange to the Manual Payroll Entry dropdown
    // every time the Payroll tab re-renders (it's rebuilt from scratch
    // each time renderPayroll() runs).
    const _origRenderPayroll = window.renderPayroll;
    if(typeof _origRenderPayroll === 'function'){
      window.renderPayroll = async function(){
        await _origRenderPayroll.apply(this, arguments);
        const sel = document.getElementById('manualPayrollEmpSel');
        if(sel){
          // add data-id to each option so autoFillManualPayrollDays can find the emp id
          Array.from(sel.options).forEach(o=>{
            const emp = (window.employees||[]).find(e=>e.name===o.value);
            if(emp) o.dataset.id = emp.id;
          });
          const periodSel = document.getElementById('payrollPeriodSel');
          const [selStart, selEnd] = (periodSel?.value || LS.get('payroll_period','')).split('_');
          sel.onchange = () => window.autoFillManualPayrollDays(selStart, selEnd);
        }
      };
    }

    console.log('✅ Oniisan DTR/Payroll days-worked fix loaded.');
  });

})();
