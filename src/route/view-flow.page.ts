/** Self-contained live execution dashboard served by `/view-flow`. */
export const flowDashboardPage = String.raw`<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width,initial-scale=1">
  <link rel="icon" href="data:,">
  <title>Backend Flow · Live</title>
  <style>
    :root{color-scheme:dark;--bg:#090b10;--panel:#11151d;--line:#242b38;--muted:#8993a4;--text:#edf1f7;--green:#42d392;--blue:#6aa7ff;--amber:#f6c760;--red:#ff6b7a;--violet:#a98bff}
    *{box-sizing:border-box}body{margin:0;background:radial-gradient(circle at 50% -20%,#192338 0,transparent 42%),var(--bg);color:var(--text);font:14px/1.5 Inter,ui-sans-serif,system-ui,-apple-system,sans-serif}
    header{position:sticky;top:0;z-index:4;display:flex;align-items:center;justify-content:space-between;padding:18px 28px;border-bottom:1px solid var(--line);background:rgba(9,11,16,.88);backdrop-filter:blur(18px)}
    h1{font-size:17px;margin:0;letter-spacing:-.02em}.eyebrow{font:11px ui-monospace,SFMono-Regular,monospace;color:var(--muted);letter-spacing:.14em;text-transform:uppercase}
    .status{display:flex;align-items:center;gap:9px;color:var(--muted)}.dot{width:8px;height:8px;border-radius:50%;background:var(--red);box-shadow:0 0 16px currentColor}.online .dot{background:var(--green)}.online{color:var(--green)}
    main{max-width:1500px;margin:auto;padding:24px 28px 50px}.notice{display:flex;justify-content:space-between;gap:20px;padding:12px 16px;margin-bottom:18px;border:1px solid #263047;border-radius:10px;background:#101623;color:#aeb9cc;font-size:12px}
    .stats{display:grid;grid-template-columns:repeat(4,1fr);gap:12px;margin-bottom:18px}.stat{padding:16px;border:1px solid var(--line);border-radius:12px;background:linear-gradient(145deg,#141923,#0e1219)}.stat b{display:block;font-size:25px;letter-spacing:-.04em}.stat span{color:var(--muted);font-size:12px}
    .pipeline{display:grid;grid-template-columns:repeat(8,1fr);gap:8px;padding:14px;margin-bottom:18px;border:1px solid var(--line);border-radius:12px;background:var(--panel)}.node{position:relative;padding:11px 8px;text-align:center;border:1px solid var(--line);border-radius:8px;color:var(--muted);font-size:11px;text-transform:uppercase;letter-spacing:.08em;transition:.2s}.node.active{color:#fff;border-color:var(--blue);background:#17233a;box-shadow:0 0 22px rgba(106,167,255,.16)}
    .toolbar{display:flex;gap:10px;margin-bottom:12px}.toolbar input,.toolbar select,.toolbar button{border:1px solid var(--line);border-radius:8px;background:#10141c;color:var(--text);padding:9px 11px}.toolbar input{flex:1}.toolbar button{cursor:pointer}.toolbar button:hover{border-color:#56647d}
    .layout{display:grid;grid-template-columns:minmax(0,1fr) 340px;gap:14px}.feed,.side{border:1px solid var(--line);border-radius:12px;background:rgba(17,21,29,.82)}.feed{min-height:480px;max-height:70vh;overflow:auto}.empty{padding:90px 24px;text-align:center;color:var(--muted)}
    .event{display:grid;grid-template-columns:118px 12px minmax(0,1fr);gap:12px;padding:15px 18px;border-bottom:1px solid #1d2330}.event:last-child{border-bottom:0}.time{color:var(--muted);font:11px ui-monospace,SFMono-Regular,monospace}.rail{position:relative}.rail:before{content:"";position:absolute;top:6px;left:4px;width:7px;height:7px;border-radius:50%;background:var(--blue);box-shadow:0 0 10px currentColor}.rail:after{content:"";position:absolute;top:18px;bottom:-22px;left:7px;border-left:1px solid #2a3242}
    .event[data-level="decision"] .rail:before{background:var(--amber)}.event[data-level="success"] .rail:before{background:var(--green)}.event[data-level="error"] .rail:before{background:var(--red)}
    .event-head{display:flex;align-items:center;gap:8px;flex-wrap:wrap}.badge{padding:2px 7px;border:1px solid #30394a;border-radius:99px;color:#afbad0;font:10px ui-monospace,SFMono-Regular,monospace;text-transform:uppercase}.action{font-weight:650}.duration{color:var(--green);font:11px ui-monospace,SFMono-Regular,monospace}.summary{margin-top:4px;color:#b8c1d0}.context{margin-top:7px;color:#7f8ba0;font:11px ui-monospace,SFMono-Regular,monospace}
    details{margin-top:8px}summary{cursor:pointer;color:#7e91b4;font-size:11px}pre{white-space:pre-wrap;word-break:break-word;padding:10px;border-radius:7px;background:#090c12;color:#aab6ca;font:11px/1.55 ui-monospace,SFMono-Regular,monospace}
    .side{padding:16px;height:max-content}.side h2{margin:0 0 12px;font-size:13px}.count-row{display:flex;justify-content:space-between;padding:8px 0;border-bottom:1px solid #1d2330;color:var(--muted)}.count-row b{color:var(--text)}.legend{margin-top:18px;color:var(--muted);font-size:12px}
    @media(max-width:900px){.stats{grid-template-columns:repeat(2,1fr)}.pipeline{grid-template-columns:repeat(4,1fr)}.layout{grid-template-columns:1fr}.side{display:none}.event{grid-template-columns:86px 10px 1fr}header,main{padding-left:16px;padding-right:16px}}
  </style>
</head>
<body>
  <header><div><div class="eyebrow">Runtime observability</div><h1>Backend decision flow</h1></div><div id="status" class="status"><span class="dot"></span><span>Connecting</span></div></header>
  <main>
    <div class="notice"><span>Operational decisions, calls, timing, and outcomes are shown live. Credentials are redacted.</span><span>Private model chain-of-thought is never exposed.</span></div>
    <section class="stats"><div class="stat"><b id="total">0</b><span>events retained</span></div><div class="stat"><b id="traces">0</b><span>correlated traces</span></div><div class="stat"><b id="decisions">0</b><span>decisions</span></div><div class="stat"><b id="errors">0</b><span>errors</span></div></section>
    <section class="pipeline" id="pipeline"></section>
    <div class="toolbar"><input id="search" placeholder="Filter action, summary, trace, details…"><select id="stage"><option value="">All stages</option></select><button id="pause">Pause</button><button id="clear">Clear view</button></div>
    <div class="layout"><section class="feed" id="feed"><div class="empty">Waiting for backend activity…</div></section><aside class="side"><h2>Stage activity</h2><div id="counts"></div><div class="legend">Events are process-local and retained in a bounded memory buffer. Times use the backend clock and durations use a monotonic timer.</div></aside></div>
  </main>
  <script>
    (function(){
      var stages=['http','websocket','conversation','retrieval','model','tool','enterprise','response'];
      var events=[], paused=false, pending=[], activeTimers={};
      var feed=document.getElementById('feed'), status=document.getElementById('status');
      var pipeline=document.getElementById('pipeline'), stageSelect=document.getElementById('stage');
      stages.forEach(function(stage){
        var node=document.createElement('div'); node.className='node'; node.dataset.stage=stage; node.textContent=stage; pipeline.appendChild(node);
        var option=document.createElement('option'); option.value=stage; option.textContent=stage; stageSelect.appendChild(option);
      });
      function escapeText(value){return value==null?'':String(value)}
      function activate(stage){
        var node=pipeline.querySelector('[data-stage=\"'+stage+'\"]'); if(!node)return;
        node.classList.add('active'); clearTimeout(activeTimers[stage]);
        activeTimers[stage]=setTimeout(function(){node.classList.remove('active')},1300);
      }
      function addEvent(event){
        if(paused){pending.push(event);return}
        events.push(event); if(events.length>500)events.shift(); activate(event.stage); render();
      }
      function render(){
        var query=document.getElementById('search').value.toLowerCase(), selected=stageSelect.value;
        var visible=events.filter(function(event){return(!selected||event.stage===selected)&&(!query||JSON.stringify(event).toLowerCase().includes(query))});
        feed.innerHTML='';
        if(!visible.length){feed.innerHTML='<div class=\"empty\">No matching execution events.</div>'}
        visible.slice().reverse().forEach(function(event){
          var item=document.createElement('article'); item.className='event'; item.dataset.level=event.level;
          var time=document.createElement('div'); time.className='time'; var date=new Date(event.timestamp); time.textContent=date.toLocaleTimeString([], {hour12:false})+'.'+String(date.getMilliseconds()).padStart(3,'0');
          var rail=document.createElement('div'); rail.className='rail';
          var body=document.createElement('div'); var head=document.createElement('div'); head.className='event-head';
          var badge=document.createElement('span'); badge.className='badge'; badge.textContent=event.stage;
          var action=document.createElement('span'); action.className='action'; action.textContent=event.action;
          head.append(badge,action);
          if(event.durationMs!=null){var duration=document.createElement('span');duration.className='duration';duration.textContent=event.durationMs+' ms';head.appendChild(duration)}
          var summary=document.createElement('div');summary.className='summary';summary.textContent=event.summary;body.append(head,summary);
          if(event.context){var context=document.createElement('div');context.className='context';context.textContent=['trace '+event.context.traceId,event.context.requestId&&'request '+event.context.requestId,event.context.conversationId&&'conversation '+event.context.conversationId].filter(Boolean).join(' · ');body.appendChild(context)}
          if(event.details&&Object.keys(event.details).length){var details=document.createElement('details'), label=document.createElement('summary'), pre=document.createElement('pre');label.textContent='inspect details';pre.textContent=JSON.stringify(event.details,null,2);details.append(label,pre);body.appendChild(details)}
          item.append(time,rail,body);feed.appendChild(item);
        });
        var traces=new Set(events.map(function(e){return e.context&&e.context.traceId}).filter(Boolean));
        document.getElementById('total').textContent=events.length;document.getElementById('traces').textContent=traces.size;
        document.getElementById('decisions').textContent=events.filter(function(e){return e.level==='decision'}).length;
        document.getElementById('errors').textContent=events.filter(function(e){return e.level==='error'}).length;
        var counts=document.getElementById('counts');counts.innerHTML='';
        ['system'].concat(stages).forEach(function(stage){var row=document.createElement('div');row.className='count-row';var name=document.createElement('span'),count=document.createElement('b');name.textContent=stage;count.textContent=events.filter(function(e){return e.stage===stage}).length;row.append(name,count);counts.appendChild(row)});
      }
      document.getElementById('search').addEventListener('input',render);stageSelect.addEventListener('change',render);
      document.getElementById('clear').addEventListener('click',function(){events=[];render()});
      document.getElementById('pause').addEventListener('click',function(e){paused=!paused;e.target.textContent=paused?'Resume':'Pause';if(!paused){events=events.concat(pending).slice(-500);pending=[];render()}});
      var source=new EventSource('/view-flow/events'+location.search);
      source.addEventListener('snapshot',function(message){events=JSON.parse(message.data);render()});
      source.addEventListener('flow',function(message){addEvent(JSON.parse(message.data))});
      source.onopen=function(){status.className='status online';status.lastElementChild.textContent='Live'};
      source.onerror=function(){status.className='status';status.lastElementChild.textContent='Reconnecting'};
    })();
  </script>
</body>
</html>`;
