"use strict";
/* hp11c-view.js - HP-11C view / rendering layer */

var CONFIG={lcdFx:0.1762,lcdFy:0.076,lcdFw:0.478,lcdFh:0.1495,colFx:[0.095,0.185,0.27,0.365,0.455,0.545,0.64,0.731,0.822,0.912],rowFy:[0.405,0.56,0.72,0.885],khw:0.037,khh:0.044,enterCy:0.81,enterHh:0.126,enterCol:5};
var LCD_PARAMS={leftEdgeFrac:0.185,rightEdgeFrac:0.631,baselineY:0.17,digitH:0.07,gapFrac:0.44,autoGap:false,minusGhost:false,ghostSegments:false};
var ANN_PARAMS={annBaselineY:0.2,annH:0.026,annFx:[0.2,0.237,0.305,0.335,0.36,0.44,0.49,0.550,0.605],annPartGap:0.02};
var COL={on:"#23271f",lcd:"#9fb393"};
var COL_ON="#1a1a1a";
var COL_OFF="rgba(26,26,26,0.055)";

var DW=34,DH=50,ST=7.0;
var MINUS_HALF=11.15,MINUS_TOP=20.38,MINUS_BOT=27.38,MINUS_SLANT=0.47;
var SEGP={
    a:"M30.73,1.08L23.41,8.08L11.30,8.08L5.19,1.08Z",
    b:"M32.69,2.08L31.41,21.20L29.28,22.77L24.46,19.14L24.99,9.09Z",
    c:"M28.93,47.49L31.11,26.20L28.95,24.47L23.52,28.55L22.36,41.17Z",
    d:"M27.48,48.72L20.94,41.72L8.72,41.72L2.03,48.72Z",
    e:"M0.91,47.69L2.17,26.83L4.09,25.22L9.08,28.98L8.14,40.53Z",
    f:"M3.99,3.20L2.35,21.88L4.28,23.42L9.78,19.31L10.49,9.99Z",
    g:"M11.09,20.38L23.45,20.38L27.93,23.88L22.83,27.38L10.17,27.38L5.61,23.88Z"
};
var CLIPD="M7.68,1.08L29.26,1.08A3.5,3.5,0,0,1,32.47,4.57L29.09,45.23A3.5,3.5,0,0,1,25.30,48.72L4.35,48.72A3.5,3.5,0,0,1,1.09,45.23L3.94,4.57A3.5,3.5,0,0,1,7.68,1.08Z";
var SEGMAP={'0':'abcdef','1':'bc','2':'abged','3':'abgcd','4':'fgbc','5':'afgcd','6':'afgedc','7':'abc','8':'abcdefg','9':'abcdfg','-':'g',' ':'','p':'abefg','P':'abefg','E':'adefg','r':'eg','o':'cdeg'};
var DOT_W=7.339,DOT_H=7.0,DOT_RY=1.576;
var TAIL_D="M-0.493,8.022C2.298,8.659,3.931,8.590,6.618,8.267C3.864,10.553,-0.151,15.979,-2.153,14.472C-3.390,12.508,-1.403,10.273,-0.493,8.022Z";

var ROWS=(window.LEG&&window.LEG.grid?window.LEG.grid:[]).map(function(row){return row.map(function(cell){return cell?cell.id:null;});});

function $(id){return document.getElementById(id);}
var svg=$("svg"),gMask=$("gMask"),gAnn=$("gAnn"),gLcd=$("gLcd"),gHot=$("gHot"),face=$("face");
var engine=(typeof window!=="undefined"&&window.HP11C_ENGINE)?window.HP11C_ENGINE:new Engine();
var W=1280,H=928;

var prefixHeld=false,holdId=null,mantTimer=null,scrollTimeout=null,scrollInterval=null;

function cancelMantissaRevert(){if(mantTimer){clearTimeout(mantTimer);mantTimer=null;}}
function scheduleMantissaRevert(){cancelMantissaRevert();mantTimer=setTimeout(function(){mantTimer=null;if(engine.mantissa&&!prefixHeld){engine.mantissa=false;render();}},1000);}
function releasePrefixHold(){if(prefixHeld){prefixHeld=false;scheduleMantissaRevert();}}
function stopScrollRepeat(){if(scrollTimeout){clearTimeout(scrollTimeout);scrollTimeout=null;}if(scrollInterval){clearInterval(scrollInterval);scrollInterval=null;}}
/* spec 18.1/18.2: 1s initial delay, then 0.5s per step */
function startProgramScrollRepeat(id,layer){stopScrollRepeat();scrollTimeout=setTimeout(function(){scrollInterval=setInterval(function(){engine.press(id,layer);render();},500);},1000);}
function clearAllHotDown(){var d=gHot.querySelectorAll(".hot.down"),i;for(i=0;i<d.length;i++)d[i].classList.remove("down");}

var CMEM_KEY="hp11c-cmem-v1";
var AUTO_OFF_MS=10*60*1000,autoOffTimer=null;
function cmemEnabled(){var cb=$("cmem");return!cb||cb.checked;}
function saveState(){if(!cmemEnabled())return;try{localStorage.setItem(CMEM_KEY,JSON.stringify(engine.serialize()));}catch(err){}}
function syncControls(){var r=$("radix");if(r)r.checked=(engine.radix===",");var l=$("lowbat");if(l)l.checked=!!engine.lowbat;}
function toggleRadixMark(){if(engine.radix==="."){engine.radix=",";engine.sep=".";}else{engine.radix=".";engine.sep=",";}syncControls();}
function doMemoryReset(){engine.reset();engine.prError=true;syncControls();}
function pokeAutoOff(){if(autoOffTimer)clearTimeout(autoOffTimer);autoOffTimer=setTimeout(function(){if(!engine.off){engine.off=true;render();if(window.__boot)window.__boot("auto-off (spec 1.8)");}},AUTO_OFF_MS);}

var GRID=null;
function computeGrid(){
    var digitH=LCD_PARAMS.digitH*H;
    var s=digitH/DH;
    var digitW=DW*s;
    var segH=ST*s;
    var minusW=2*MINUS_HALF*s;
    var left=LCD_PARAMS.leftEdgeFrac*W;
    var right=LCD_PARAMS.rightEdgeFrac*W;
    var baselineY=LCD_PARAMS.baselineY*H;
    var digitTop=baselineY-digitH;
    var gap;
    if(LCD_PARAMS.autoGap===true){gap=(right-left-minusW-10*digitW)/11;if(gap<0)gap=0;}
    else gap=LCD_PARAMS.gapFrac*digitW;
    var d1=left+minusW+gap;
    GRID={digitH:digitH,digitW:digitW,s:s,segH:segH,gap:gap,minusW:minusW,left:left,right:right,baselineY:baselineY,digitTop:digitTop,minusCx:left+minusW/2,
        columnX:function(i){return d1+i*(digitW+gap);},
        sepX:function(i){return d1+i*(digitW+gap)+digitW+gap/2;}};
}

function drawDigit(x,y,h,ch,showOff){
    var segs=SEGMAP[ch];if(!segs)return'';
    var s=h/DH;
    var out='<g transform="translate('+x.toFixed(2)+','+y.toFixed(2)+') scale('+s.toFixed(5)+')"><g clip-path="url(#hp11cDigitClip)">';
    if(showOff&&LCD_PARAMS.ghostSegments){var all='abcdefg',i;for(i=0;i<7;i++){if(segs.indexOf(all[i])<0)out+='<path d="'+SEGP[all[i]]+'" fill="'+COL_OFF+'"/>';}}
    for(var j=0;j<segs.length;j++)out+='<path d="'+SEGP[segs[j]]+'" fill="'+COL_ON+'"/>';
    return out+'</g></g>';
}

function drawMark(cx,baseY,segH,isComma){
    var dh=segH,dw=DOT_W*(segH/DOT_H),ry=DOT_RY*(segH/DOT_H);
    var dotBottom=baseY-0.2*segH,dotTop=dotBottom-dh,dotLeft=cx-dw/2;
    var sc=segH/DOT_H;
    var out='<rect x="'+dotLeft.toFixed(2)+'" y="'+dotTop.toFixed(2)+'" width="'+dw.toFixed(2)+'" height="'+dh.toFixed(2)+'" rx="'+ry.toFixed(2)+'" ry="'+ry.toFixed(2)+'" fill="'+COL_ON+'"/>';
    if(isComma)out+='<g transform="translate('+dotLeft.toFixed(2)+','+dotTop.toFixed(2)+') scale('+sc.toFixed(5)+')"><path d="'+TAIL_D+'" fill="'+COL_ON+'"/></g>';
    return out;
}

function drawMinusAt(g,cx,col){
    var x0=-MINUS_HALF,x1=MINUS_HALF;
    var pts=(x0+MINUS_SLANT)+','+MINUS_TOP+' '+(x1+MINUS_SLANT)+','+MINUS_TOP+' '+x1+','+MINUS_BOT+' '+x0+','+MINUS_BOT;
    return'<g transform="translate('+cx.toFixed(2)+','+g.digitTop.toFixed(2)+') scale('+g.s.toFixed(5)+')"><polygon points="'+pts+'" fill="'+col+'"/></g>';
}

function paintMinusColumn(g,lit){
    if(lit)return drawMinusAt(g,g.minusCx,COL_ON);
    if(LCD_PARAMS.minusGhost)return drawMinusAt(g,g.minusCx,COL_OFF);
    return'';
}

function parseCells(cells){
    var minus=false,man=[],expSign=false,expD=[],hasGap=false,phase='man',i,c;
    for(i=0;i<cells.length;i++){
        c=cells[i];
        if(c.gap){hasGap=true;phase='exp';}
        else if(c.sign)minus=true;
        else if(c.es)expSign=true;
        else if(c.ed!=null)expD.push(c.ed);
        else if(c.d!=null){
            if(phase==='man')man.push({ch:c.d,sepType:c.comma?'thousands':(c.dot?'decimal':null)});
            else expD.push(c.d);
        }
    }
    return{minus:minus,man:man,expSign:expSign,exp:expD,hasGap:hasGap};
}

function sepIsComma(sepType){
    if(sepType==='decimal')return(engine.radix===',');
    if(sepType==='thousands')return(engine.sep===',');
    return false;
}

function renderNumberLCD(cells){
    if(!GRID)computeGrid();
    var g=GRID,info=parseCells(cells||[]),slots=[],i;
    for(i=0;i<10;i++)slots.push(null);
    if(info.hasGap){
        var m=info.man.slice(0,7);
        for(i=0;i<m.length;i++)slots[i]=m[i];
        slots[7]=info.expSign?{ch:'-',sepType:null,isExpSign:true}:null;
        var ed=info.exp.slice();while(ed.length<2)ed.unshift('0');if(ed.length>2)ed=ed.slice(ed.length-2);
        slots[8]={ch:ed[0],sepType:null};slots[9]={ch:ed[1],sepType:null};
    }else{
        var m2=info.man.slice(0,10);
        for(i=0;i<m2.length;i++)slots[i]=m2[i];
    }
    var s=paintMinusColumn(g,info.minus);
    for(i=0;i<10;i++){
        var sl=slots[i];if(!sl)continue;
        if(sl.isExpSign)s+=drawMinusAt(g,g.columnX(i)+g.digitW/2,COL_ON);
        else if(sl.ch&&sl.ch!==' ')s+=drawDigit(g.columnX(i),g.digitTop,g.digitH,sl.ch,true);
        if(sl.sepType)s+=drawMark(g.sepX(i),g.baselineY,g.segH,sepIsComma(sl.sepType));
    }
    gLcd.innerHTML=s;
}

function renderProgramLCD(cells){
    if(!GRID)computeGrid();
    var g=GRID,s=paintMinusColumn(g,false),i;
    var n=Math.min((cells&&cells.length)||10,10);
    for(i=0;i<n;i++){
        var c=cells[i];if(!c)continue;
        if(c.d!=null&&c.d!==' ')s+=drawDigit(g.columnX(i),g.digitTop,g.digitH,c.d,false);
        if(c.dot)s+=drawMark(g.sepX(i),g.baselineY,g.segH,(engine.radix!==','));
    }
    gLcd.innerHTML=s;
}

var ANN_ITEMS=[
    {t:"*",fxIdx:0,blink:true,on:function(e){return!!e.lowbat;}},
    {t:"USER",fxIdx:1,on:function(e){return!!e.user;}},
    {t:"f",fxIdx:2,on:function(e){return e.prefix==="f";}},
    {t:"g",fxIdx:3,on:function(e){return e.prefix==="g";}},
    {t:"BEGIN",fxIdx:4,on:function(){return false;}},
    {t:"GRAD",fxIdx:5,on:function(e){return e.trigMode==="GRAD"||e.trigMode==="RAD";},
        parts:[{s:"G",w:1,on:function(e){return e.trigMode==="GRAD";}},
               {s:"RAD",w:0.92,on:function(e){return e.trigMode==="GRAD"||e.trigMode==="RAD";}}]},
    {t:"D.MY",label:"D.MY",fxIdx:6,on:function(){return false;}},
    {t:"C",fxIdx:7,on:function(){return false;}},
    {t:"PRGM",fxIdx:8,on:function(e){return!!e.programMode;}}
];

function renderAnn(){
    var ay=ANN_PARAMS.annBaselineY*H;
    var fs=ANN_PARAMS.annH*H;
    var s="",i,j,a,parts,xx,pw,cx,cls;
    for(i=0;i<ANN_ITEMS.length;i++){
        a=ANN_ITEMS[i];
        if(!a.on(engine))continue;
        xx=(ANN_PARAMS.annFx[a.fxIdx]!=null?ANN_PARAMS.annFx[a.fxIdx]:0)*W;
        parts=a.parts||[{s:a.label||a.t,w:1}];
        cls=a.blink?' class="ann-blink"':'';
        if(parts.length===1){
            s+='<text'+cls+' x="'+xx.toFixed(1)+'" y="'+ay.toFixed(1)+'" font-family="ui-monospace,Menlo,Consolas,monospace" font-size="'+fs.toFixed(2)+'" fill="'+COL.on+'">'+parts[0].s+'</text>';
        }else{
            cx=xx;
            for(j=0;j<parts.length;j++){
                pw=parts[j].s.length*parts[j].w*fs*0.62;
                if(!parts[j].on||parts[j].on(engine)){
                    s+='<text x="'+(cx+pw/2).toFixed(1)+'" y="'+ay.toFixed(1)+'" text-anchor="middle" font-family="ui-monospace,Menlo,Consolas,monospace" font-size="'+fs.toFixed(2)+'" letter-spacing="'+((parts[j].w-1)*fs).toFixed(2)+'" fill="'+COL.on+'">'+parts[j].s+'</text>';
                }
                cx+=pw+fs*ANN_PARAMS.annPartGap;
            }
        }
    }
    gAnn.innerHTML=s;
}

function renderAllLit(){
    if(!GRID)computeGrid();
    var g=GRID,s=drawMinusAt(g,g.minusCx,COL_ON),i,j;
    for(i=0;i<10;i++){s+=drawDigit(g.columnX(i),g.digitTop,g.digitH,'8',false);s+=drawMark(g.sepX(i),g.baselineY,g.segH,true);}
    gLcd.innerHTML=s;
    var ay=ANN_PARAMS.annBaselineY*H,fs=ANN_PARAMS.annH*H,a="";
    var legends=['*','USER','f','g','BEGIN','GRAD','D.MY','C','PRGM'];
    for(j=0;j<legends.length;j++)a+='<text x="'+(ANN_PARAMS.annFx[j]*W).toFixed(1)+'" y="'+ay.toFixed(1)+'" font-family="ui-monospace,Menlo,Consolas,monospace" font-size="'+fs.toFixed(2)+'" fill="'+COL.on+'">'+legends[j]+'</text>';
    gAnn.innerHTML=a;
}

function renderPrError(){
    var g=GRID;var word=['P','r',' ','E','r','r','o','r'];
    var start=Math.floor((10-word.length)/2);
    var s=paintMinusColumn(g,false),i;
    for(i=0;i<word.length;i++){if(word[i]!==' ')s+=drawDigit(g.columnX(start+i),g.digitTop,g.digitH,word[i],false);}
    gLcd.innerHTML=s;
}

function renderErrorLCD(n){
    var g=GRID;
    /* ROM: "Error" + blank + digit, 7 glyphs centred d2..d8 */
    var word=['E','r','r','o','r',' ',String(n%10)];
    var start=Math.floor((10-word.length)/2);
    var s=paintMinusColumn(g,false),i;
    for(i=0;i<word.length;i++)s+=drawDigit(g.columnX(start+i),g.digitTop,g.digitH,word[i],false);
    gLcd.innerHTML=s;
}

function render(){
    try{
        if(!GRID)computeGrid();
        var seg=$("segtest");
        if(seg&&seg.checked)renderAllLit();
        else if(engine.off){gLcd.innerHTML='';gAnn.innerHTML='';}
        else{
            var f=engine.fmt();
            if(f.prError){renderPrError();renderAnn();}
            else if(f.error!=null){renderErrorLCD(f.error);renderAnn();}
            else if(f.program){renderProgramLCD(f.cells);renderAnn();}
            else{renderNumberLCD(f.cells);renderAnn();}
        }
        updateInspector();saveState();
    }catch(err){if(window.__boot)window.__boot("render ERR: "+err.message);}
}

function buildFace(){
    gMask.innerHTML='<rect x="'+(CONFIG.lcdFx*W)+'" y="'+(CONFIG.lcdFy*H)+'" width="'+(CONFIG.lcdFw*W)+'" height="'+(CONFIG.lcdFh*H)+'" rx="4" fill="'+COL.lcd+'"></rect>';
    var s="",cw=CONFIG.khw*2*W,ch=CONFIG.khh*2*H,r,row,i,id;
    for(r=0;r<ROWS.length;r++){
        row=ROWS[r];
        for(i=0;i<row.length;i++){
            id=row[i];if(!id)continue;
            s+='<rect class="hot" data-id="'+id+'" x="'+(CONFIG.colFx[i]*W-cw/2).toFixed(1)+'" y="'+(CONFIG.rowFy[r]*H-ch/2).toFixed(1)+'" width="'+cw.toFixed(1)+'" height="'+ch.toFixed(1)+'" rx="6"></rect>';
        }
    }
    var ecx=CONFIG.colFx[CONFIG.enterCol]*W,ecy=CONFIG.enterCy*H;
    var ew=CONFIG.khw*2*W,eh=CONFIG.enterHh*2*H;
    s+='<rect class="hot" data-id="ENTER" x="'+(ecx-ew/2).toFixed(1)+'" y="'+(ecy-eh/2).toFixed(1)+'" width="'+ew.toFixed(1)+'" height="'+eh.toFixed(1)+'" rx="6"></rect>';
    gHot.innerHTML=s;
    var rects=gHot.querySelectorAll(".hot");
    for(i=0;i<rects.length;i++){
        (function(rect){
            var id=rect.getAttribute("data-id");
            rect.addEventListener("pointerdown",function(e){
                e.preventDefault();rect.classList.add("down");pokeAutoOff();stopScrollRepeat();
                if(engine.off){
                    if(id==="DOT")dotHeldPt=true;
                    if(id==="SUB")minusHeldPt=true;
                    if(id==="ON"){onArmed=true;engine.press("ON","P");if(minusHeldPt||minusHeldKb)doMemoryReset();else if(dotHeldPt||dotHeldKb)toggleRadixMark();render();}
                    return;
                }
                if(onArmed){if(id==="SUB"){resetPending=true;return;}if(id==="DOT"){radixPending=true;return;}}
                if(engine.previewLine!=null&&id!=="SST")engine.previewLine=null;
                var layer=engine.prefix||"P";
                var act=engine.effective?engine.effective(id,layer):null;
                var mayHoldMantissa=(id==="BACK"&&layer==="f"&&!engine.programMode);
                if(!engine.programMode&&!engine.running&&id==="SST"&&act==="SST"){
                    var nl=engine.nextRunLine();if(nl>0){engine.previewLine=nl;render();}return;
                }
                if(engine.programMode&&(act==="SST"||act==="BST")){engine.press(id,layer);render();startProgramScrollRepeat(id,layer);return;}
                engine.press(id,layer);
                if(mayHoldMantissa&&engine.mantissa){prefixHeld=true;holdId=id;}
                render();
            });
            rect.addEventListener("pointerup",function(){
                rect.classList.remove("down");stopScrollRepeat();
                if(id==="ON"&&onArmed){onArmed=false;if(resetPending){resetPending=false;radixPending=false;doMemoryReset();render();return;}if(radixPending){radixPending=false;toggleRadixMark();render();}}
                if(!engine.programMode&&id==="SST"&&engine.previewLine!=null){engine.previewLine=null;engine.runStep();render();}
                if(engine.release){engine.release();render();}
                if(holdId===id){holdId=null;releasePrefixHold();}
            });
            rect.addEventListener("pointerleave",function(){rect.classList.remove("down");});
            rect.addEventListener("pointercancel",function(){rect.classList.remove("down");stopScrollRepeat();if(engine.previewLine!=null){engine.previewLine=null;render();}if(holdId===id){holdId=null;releasePrefixHold();}});
        })(rects[i]);
    }
}

function applySize(nw,nh){
    if(!nw||!nh)return;
    W=nw;H=nh;GRID=null;
    svg.setAttribute("viewBox","0 0 "+nw+" "+nh);
    svg.setAttribute("preserveAspectRatio","xMidYMid meet");
    svg.removeAttribute("width");svg.removeAttribute("height");
    svg.style.width="100%";svg.style.height="auto";svg.style.display="block";svg.style.aspectRatio=nw+" / "+nh;
    face.setAttribute("x","0");face.setAttribute("y","0");face.setAttribute("width",nw);face.setAttribute("height",nh);
    face.setAttribute("preserveAspectRatio","xMidYMid meet");
    buildFace();render();
    if(window.__boot)window.__boot("ALIGN OK "+nw+"x"+nh);
}

function hrefOf(el){
    if(el.href&&el.href.baseVal)return el.href.baseVal;
    return el.getAttribute("href")||el.getAttributeNS("http://www.w3.org/1999/xlink","href")||el.getAttribute("xlink:href")||"";
}

function trySetup(){
    var src=hrefOf(face);
    if(!src){if(window.__boot)window.__boot("ALIGN ERR: no image href");return;}
    var probe=new Image();
    probe.onload=function(){applySize(probe.naturalWidth,probe.naturalHeight);};
    probe.onerror=function(){if(window.__boot)window.__boot("ALIGN ERR: probe failed "+src);};
    probe.src=src;
}

face.addEventListener("error",function(){
    gMask.innerHTML+='<rect x="0" y="0" width="1280" height="928" rx="24" fill="#c9c9c9"></rect><text x="640" y="470" text-anchor="middle" font-family="monospace" font-size="22" fill="#333">place HP11c_image.png next to this file</text>';
    applySize(1280,928);
});

window.addEventListener("load",trySetup);
setTimeout(trySetup,150);
setTimeout(trySetup,600);
trySetup();

var onArmed=false,resetPending=false,radixPending=false;
var dotHeldPt=false,minusHeldPt=false,dotHeldKb=false,minusHeldKb=false;

window.addEventListener("pointerup",function(){clearAllHotDown();stopScrollRepeat();onArmed=false;resetPending=false;radixPending=false;dotHeldPt=false;minusHeldPt=false;if(engine.off){if(holdId){holdId=null;releasePrefixHold();}return;}if(engine.previewLine!=null){engine.previewLine=null;engine.runStep();render();}if(engine.release){engine.release();render();}if(holdId){holdId=null;releasePrefixHold();}});
window.addEventListener("pointercancel",function(){clearAllHotDown();stopScrollRepeat();onArmed=false;resetPending=false;radixPending=false;dotHeldPt=false;minusHeldPt=false;if(engine.previewLine!=null){engine.previewLine=null;render();}if(holdId){holdId=null;releasePrefixHold();}});

(function injectClip(){
    var svgEl=document.getElementById("svg");
    if(!svgEl||document.getElementById("hp11cDigitClip"))return;
    var defs=document.createElementNS("http://www.w3.org/2000/svg","defs");
    var cp=document.createElementNS("http://www.w3.org/2000/svg","clipPath");
    cp.setAttribute("id","hp11cDigitClip");
    var p=document.createElementNS("http://www.w3.org/2000/svg","path");
    p.setAttribute("d",CLIPD);
    cp.appendChild(p);defs.appendChild(cp);
    svgEl.insertBefore(defs,svgEl.firstChild);
})();

var KB={"0":"0","1":"1","2":"2","3":"3","4":"4","5":"5","6":"6","7":"7","8":"8","9":"9",".":"DOT","Enter":"ENTER","Backspace":"BACK","+":"ADD","-":"SUB","*":"MUL","/":"DIV"};

window.addEventListener("keydown",function(e){
    var target=e.target,tag=target&&target.tagName;
    if(tag==="TEXTAREA")return;
    if(tag==="INPUT"&&(target.type==="text"||target.type==="number"||target.type==="search"||target.isContentEditable))return;
    var k=e.key;pokeAutoOff();
    if(engine.off){
        if(k==="."){dotHeldKb=true;e.preventDefault();return;}
        if(k==="-"){minusHeldKb=true;e.preventDefault();return;}
        if(k!=="o"&&k!=="O"){e.preventDefault();return;}
    }
    if((k==="f"||k==="g")&&e.repeat){e.preventDefault();return;}
    if(k==="Backspace"&&e.repeat&&(prefixHeld||engine.mantissa)){e.preventDefault();return;}
    if(k==="p"||k==="P"){engine.direct("pi");render();e.preventDefault();return;}
    if(k==="r"||k==="R"){engine.direct("sqrt");render();e.preventDefault();return;}
    if(k==="c"||k==="C"){engine.direct("clx");render();e.preventDefault();return;}
    if(k==="o"||k==="O"){
        if(minusHeldKb){minusHeldKb=false;doMemoryReset();}
        else if(dotHeldKb){dotHeldKb=false;toggleRadixMark();}
        engine.press("ON","P");render();e.preventDefault();return;
    }
    if(k==="f"){engine.press("F","P");render();e.preventDefault();return;}
    if(k==="g"){engine.press("G","P");render();e.preventDefault();return;}
    var id=KB[k];
    if(id){
        var layer=engine.prefix||"P";
        var mayHoldMantissa=(id==="BACK"&&layer==="f"&&!engine.programMode);
        engine.press(id,layer);
        if(mayHoldMantissa&&engine.mantissa)prefixHeld=true;
        render();e.preventDefault();
    }
});

window.addEventListener("keyup",function(e){
    if(e.key==="Backspace")releasePrefixHold();
    if(e.key===".")dotHeldKb=false;
    if(e.key==="-")minusHeldKb=false;
    if(engine.release){engine.release();render();}
});

function ff(v){
    if(Object.is(v,-0))return"0";
    if(!isFinite(v))return String(v);
    if(Number.isInteger(v))return v+".";
    return(+v.toPrecision(12))+"";
}

function updateInspector(){
    var i,h="",r="";
    var stack=[["T",engine.t],["Z",engine.z],["Y",engine.y],["X",engine.x]];
    for(i=0;i<stack.length;i++)h+="<div><b>"+stack[i][0]+"</b> "+ff(stack[i][1])+"</div>";
    $("stk").innerHTML=h;
    var m="<b>LASTX</b> "+ff(engine.lastX)+" <b>I</b> "+ff(engine.I)+" <b>mode</b> "+engine.display.mode+engine.display.n+" <b>trig</b> "+engine.trigMode+" <b>pfx</b> "+(engine.prefix||"-")+" <b>lift</b> "+engine.liftEnabled+" <b>key</b> "+(engine.lastKey||"-")+" <b>buf</b> \""+engine.lastBuf+"\"";
    if(engine.programMode)m+=" <b>PRGM</b> LINE: "+engine.pc;
    $("meta").innerHTML=m;
    for(i=0;i<20;i++){var label=i<10?("R"+i):("R."+(i-10));r+="<div>"+label+"="+ff(engine.reg[i])+"</div>";}
    r+="<div>I="+ff(engine.I)+"</div>";
    $("regs").innerHTML=r;
}

var _dbg=$("dbg");if(_dbg)_dbg.addEventListener("change",function(e){svg.classList.toggle("show-hot",e.target.checked);});
var _rad=$("radix");if(_rad)_rad.addEventListener("change",function(e){if(e.target.checked){engine.radix=",";engine.sep=".";}else{engine.radix=".";engine.sep=",";}render();});
var _low=$("lowbat");if(_low)_low.addEventListener("change",function(e){engine.lowbat=e.target.checked;render();});
var _seg=$("segtest");if(_seg)_seg.addEventListener("change",function(){render();});
var _cmem=$("cmem");if(_cmem)_cmem.addEventListener("change",function(e){if(!e.target.checked){try{localStorage.removeItem(CMEM_KEY);}catch(err){}}else saveState();});
var _rst=$("reset");if(_rst)_rst.addEventListener("click",function(){engine.reset();syncControls();render();});

(function bootMemory(){
    if(!cmemEnabled())return;
    try{
        var raw=localStorage.getItem(CMEM_KEY);
        if(raw){engine.restore(JSON.parse(raw));syncControls();if(window.__boot)window.__boot("CMEM: state restored");}
    }catch(err){engine.prError=true;if(window.__boot)window.__boot("CMEM: corrupt state -> Pr Error");}
})();

function selftest(){
    var e=new Engine(),log=[];
    function K(id,m){e.press(id,m||e.prefix||'P');}
    function typeNum(s){
        var neg=false,j,c;
        if(s.charAt(0)==='-'){neg=true;s=s.slice(1);}
        var ei=s.search(/[eE]/),man=ei<0?s:s.slice(0,ei),exp=ei<0?'':s.slice(ei+1);
        for(j=0;j<man.length;j++){c=man.charAt(j);if(c==='.')K('DOT');else if(c>='0'&&c<='9')K(c);}
        if(neg)K('CHS');
        if(ei>=0){K('EEX');var en=false;if(exp.charAt(0)==='-'){en=true;exp=exp.slice(1);}else if(exp.charAt(0)==='+')exp=exp.slice(1);for(j=0;j<exp.length;j++)K(exp.charAt(j));if(en)K('CHS');}
    }
    function tok(t){
        if(t==='ENTER')K('ENTER');
        else if(t==='+')K('ADD');
        else if(t==='-')K('SUB');
        else if(t==='*')K('MUL');
        else if(t==='/')K('DIV');
        else if(t==='CHS')K('CHS');
        else if(t==='y^x')K('YX');
        else if(t==='sqrt')K('SQRT');
        else if(t==='x^2')K('SQRT','g');
        else if(t==='sin')K('SIN');
        else if(t==='f')K('F');
        else if(t==='g')K('G');
        else if(t==='pi')K('CHS','f');
        else if(t==='STO')K('STO');
        else if(t==='RCL')K('RCL');
        else if(t==='SWAP')K('SWAP');
        else if(t==='LSTx')K('ENTER','g');
        else if(t==='EEX')K('EEX');
        else if(t==='GSB')K('GSB');
        else if(t==='SIGMA')K('SIGMA');
        else if(t==='%')K('YX','g');
        else if(t==='fact')K('0','f');
        else if(t==='atanh'){K('GTO','g');K('TAN');}
        else if(/^-?(?:\d+\.?\d*|\.\d+)(?:[eE][-+]?\d+)?$/.test(t))typeNum(t);
    }
    function seq(str){str.split(/\s+/).filter(Boolean).forEach(tok);}
    function ap(a,b){return Math.abs(a-b)<1e-6*(1+Math.abs(b));}
    function chk(n,g,w){log.push((ap(g,w)?'PASS':'FAIL')+' '+n+' got='+g+' want='+w);}

    seq('15 ENTER 30 * .47 *');chk('heatloss',e.x,211.5);e.reset();
    seq('2 ENTER 3 y^x');chk('2^3',e.x,8);e.reset();
    seq('2.3 ENTER 5 +');chk('2.3+5',e.x,7.3);e.reset();
    e.trigMode='DEG';seq('30 sin');chk('sin30',e.x,0.5);e.reset();
    seq('98 ENTER 15 -');chk('98-15',e.x,83);e.reset();
    seq('9 ENTER 8 -');chk('9-8',e.x,1);e.reset();
    seq('9 8 -');chk('concat 9 8 -',e.x,-98);e.reset();
    seq('1000 ENTER 15 %');chk('15% of 1000',e.x,150);e.reset();
    seq('2 ENTER 10 y^x');chk('2^10',e.x,1024);e.reset();
    seq('6.6262 EEX CHS 3 4 ENTER 50 *');chk('planck 50',e.x,3.3131e-32);e.reset();
    seq('4 CHS sqrt');chk('sqrt(-4) error',e.error,0);e.reset();
    seq('1.15 ENTER ENTER ENTER 1000 * * *');chk('const 1.15^3 1000',e.x,1520.875);e.reset();
    seq('2 ENTER 3 SWAP');chk('swap X',e.x,2);e.reset();
    seq('8 ENTER 2 / LSTx');chk('LSTx',e.x,2);e.reset();
    e.trigMode='RAD';seq('pi 2 / sin');chk('sin(pi/2) rad',e.x,1);e.reset();
    seq('123 STO 0');seq('456 STO 1');chk('R0 stored',e.reg[0],123);chk('R1 stored',e.reg[1],456);
    seq('f SWAP');chk('CLRREG R0',e.reg[0],0);chk('CLRREG R1',e.reg[1],0);e.reset();
    e.I=3;e.reg[3]=7;e.x=99;e.liftEnabled=true;K('SIN','f');chk('x<>(i) X',e.x,7);chk('x<>(i) R3',e.reg[3],99);e.reset();
    e.I=20;e.x=5;e.liftEnabled=true;K('SIN','f');chk('x<>(i) I-addr X',e.x,20);chk('x<>(i) I-addr I',e.I,5);e.reset();
    e.I=21;e.x=1;e.liftEnabled=true;K('SIN','f');chk('x<>(i) err3',e.error,3);e.reset();
    seq('5 ENTER 3 SIGMA');chk('SIGMA R0',e.reg[0],1);
    seq('f GSB');chk('CLRSIGMA R0',e.reg[0],0);chk('CLRSIGMA X',e.x,0);chk('CLRSIGMA Y',e.y,0);e.reset();

    /* RCL Sigma+ (spec 15.9) */
    seq('5 ENTER 3 SIGMA');
    K('RCL');K('SIGMA');
    chk('RCLSigma X=R1',e.x,3);
    chk('RCLSigma Y=R3',e.y,5);
    e.reset();

    /* RCL Sigma+ lift model */
    e.reg[0]=1;e.reg[1]=10;e.reg[3]=20;
    e.t=4;e.z=3;e.y=2;e.x=1;e.liftEnabled=true;
    K('RCL');K('SIGMA');
    chk('RCLSigma lift X',e.x,10);
    chk('RCLSigma lift Y',e.y,20);
    chk('RCLSigma lift Z=oldX',e.z,1);
    chk('RCLSigma lift T=oldY',e.t,2);
    e.reset();

    /* x-bar two-value model (spec 15.4) */
    e.reg[0]=1;e.reg[1]=10;e.reg[3]=20;
    e.t=4;e.z=3;e.y=2;e.x=1;e.liftEnabled=true;
    K('0','g');
    chk('MEAN X',e.x,10);
    chk('MEAN Y',e.y,20);
    chk('MEAN Z=oldX',e.z,1);
    chk('MEAN T=oldY',e.t,2);
    e.reset();

    /* spec regression checks */
    seq('4 CHS fact');chk('(-4)! -> -MAX (9.4)',e.x,-9.999999999e99);e.reset();
    seq('75 fact');chk('75! -> +MAX (9.4)',e.x,9.999999999e99);e.reset();
    seq('1.5 fact');chk('1.5! = Gamma(2.5)',e.x,1.329340388);e.reset();
    seq('5 STO / 0');chk('STO/0 -> Error 0 (23.1)',e.error,0);e.reset();
    seq('1 atanh');chk('atanh(1) no error (10.3)',e.error==null?1:0,1);e.reset();
    e.I=15;K('GTO');K('TAN');
    log.push((e.error===4?'PASS':'FAIL')+' GTO I addr 15 -> Error 4 (21.7)');e.reset();
    e.I=-0.1;K('GTO');K('TAN');
    log.push((e.error===4?'PASS':'FAIL')+' GTO I line target 0 -> Error 4 (21.7)');e.reset();

    /* program mode */
    K('RS','g');log.push((e.programMode?'PASS':'FAIL')+' Enter Program Mode (g R/S)');
    K('SST','f');K('SQRT','f');log.push((e.programMemory.length===1&&e.programMemory[0].code==='LBL A'?'PASS':'FAIL')+' Record LBL A');
    K('GTO','P');K('0','P');log.push((e.programMemory.length===2&&e.programMemory[1].code==='GTO 0'?'PASS':'FAIL')+' Record GTO 0');
    K('GSB','g');log.push((e.programMemory.length===3&&e.programMemory[2].code==='RTN'?'PASS':'FAIL')+' Record RTN');
    K('RS','g');log.push((!e.programMode&&e.pc===3?'PASS':'FAIL')+' Exit Program Mode preserves pc');e.reset();

    /* RCL Sigma+ recording */
    K('RS','g');K('RCL');K('SIGMA');
    log.push((e.programMemory.length===1&&e.programMemory[0].op==='RCLSIGMA'&&e.programMemory[0].codes.join(',')==='45,49'?'PASS':'FAIL')+' Record RCL Sigma+ as 45 49 (15.9)');
    e.reset();

    /* keycodes */
    log.push((KEYMAP.SIN.f==='XEXI'?'PASS':'FAIL')+' legend SIN gold=x<>(i) ['+KEYMAP.SIN.f+']');
    log.push((KEYMAP.GSB.f==='CLRSIGMA'?'PASS':'FAIL')+' legend GSB gold=CLEAR Sigma ['+KEYMAP.GSB.f+']');
    log.push((KEYMAP['0'].g==='MEAN'?'PASS':'FAIL')+' legend 0 blue=mean ['+KEYMAP['0'].g+']');
    log.push((KEYMAP['1'].f==='PYX'&&KEYMAP['1'].g==='CYX'?'PASS':'FAIL')+' legend 1 = P y,x / C y,x');
    log.push((KEYMAP.ENTER.f==='RAN'&&KEYMAP.ENTER.g==='lstx'?'PASS':'FAIL')+' legend ENTER = RAN# / LSTx');
    log.push((Object.keys(KEYMAP).length===39?'PASS':'FAIL')+' KEYMAP has 39 keys ['+Object.keys(KEYMAP).length+']');

    if(window.__boot)window.__boot('SELFTEST:\n'+log.join('\n'));
    var fails=log.filter(function(l){return l.indexOf('FAIL')===0;}).length;
    if(window.__boot)window.__boot('SELFTEST SUMMARY: '+(log.length-fails)+'/'+log.length+' passed');
}

render();
selftest();
pokeAutoOff();
window.HP11C_READY=true;
if(window.__boot)window.__boot("MAIN_PARSED_OK");
