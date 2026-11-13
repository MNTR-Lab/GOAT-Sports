/* Team palettes follow NAL Network's existing team branding configuration.
   Charlotte uses its purple/teal identity; neutral pages retain GOAT branding. */
(()=>{'use strict';
const teams={
 '13227365382':{name:'MNTR INC',primary:'#0177C1',accent:'#DCE7EF'},
 '13290197893':{name:'Dallas Apex',primary:'#C8102E',accent:'#E1AD01'},
 '13295833416':{name:'Amarillo Warbirds',primary:'#0051BA',accent:'#E8000D'},
 '13295849330':{name:'Colorado Spartans',primary:'#2D8BCB',accent:'#000000'},
 '13295841753':{name:'Louisiana Rouxgaroux',primary:'#CFB53B',accent:'#800000'},
 '13295832053':{name:'Omaha Beef',primary:'#F47A20',accent:'#000000'},
 '13295846269':{name:'Pueblo Punishers',primary:'#6F2DA8',accent:'#000000'},
 '13295846794':{name:'Salina Liberty',primary:'#1B325A',accent:'#E6252C'},
 '13295857085':{name:'Sioux City Bandits',primary:'#000000',accent:'#C8102E'},
 '13295842804':{name:'Southwest Kansas Storm',primary:'#6B2E8E',accent:'#5FBB46'},
 '13295842566':{name:'Wheeling Miners',primary:'#C7992C',accent:'#020202'},
 '13326288822':{name:'National Arena League',primary:'#07172B',accent:'#E31B23'},
 '13547392307':{name:'Charlotte Storm AAU',primary:'#552583',accent:'#00A6A6'}
};
const rgb=hex=>[1,3,5].map(i=>parseInt(hex.slice(i,i+2),16));
const hex=c=>'#'+c.map(v=>Math.round(v).toString(16).padStart(2,'0')).join('');
const blend=(a,b,t)=>hex(rgb(a).map((v,i)=>v*(1-t)+rgb(b)[i]*t));
const luminance=h=>rgb(h).map(v=>{v/=255;return v<=.04045?v/12.92:((v+.055)/1.055)**2.4}).reduce((s,v,i)=>s+v*[.2126,.7152,.0722][i],0);
const contrast=(a,b)=>{const x=luminance(a),y=luminance(b);return (Math.max(x,y)+.05)/(Math.min(x,y)+.05)};
function readable(color,background,lighten=false,min=4.5){for(let i=0;i<=20;i++){const c=blend(color,lighten?'#FFFFFF':'#000000',i/20);if(contrast(c,background)>=min)return c;}return lighten?'#FFFFFF':'#000000';}
const css=`body[data-team-themed="true"]{--purple:var(--team-button);--teal:var(--team-link);--goat-purple:var(--team-button);--goat-teal:var(--team-link)}
body[data-team-themed="true"] .hero{background:linear-gradient(115deg,var(--team-dark),var(--team-hero),var(--team-end))!important;border-top:4px solid var(--team-primary);box-shadow:0 8px 28px #15203b14}
body[data-team-themed="true"] .hero h1,body[data-team-themed="true"] .hero .eyebrow{color:#fff!important}
body[data-team-themed="true"] .side{background:linear-gradient(180deg,var(--team-dark),var(--team-deep))!important}
body[data-team-themed="true"] .side button.active,body[data-team-themed="true"] .side button:hover{border-left-color:var(--team-nav)!important}
body[data-team-themed="true"] .primary{background:var(--team-button)!important;color:#fff!important}
body[data-team-themed="true"] .eyebrow,body[data-team-themed="true"] .ga-kicker{color:var(--team-link)!important}
body[data-team-themed="true"] .goat-tabs button.selected{background:var(--team-button)!important;color:#fff!important}
body[data-team-themed="true"] .ga-button-outline,body[data-team-themed="true"] .goat-links a{color:var(--team-button)!important;border-color:var(--team-button)!important}
body[data-team-themed="true"] .ga-pill{background:var(--team-soft)!important;color:var(--team-button)!important}
body[data-team-themed="true"] .mobile-nav button.active{background:var(--team-soft)!important;color:var(--team-button)!important}
.locker-team-signature{display:inline-flex;align-items:center;gap:9px;font:700 11px/1.3 Arial,sans-serif;letter-spacing:.08em;text-transform:uppercase;padding:7px 10px;margin-bottom:10px;border-radius:6px;background:#ffffff12;color:white}
.locker-team-signature i{display:inline-block;width:10px;height:10px;border-radius:50%;background:var(--team-primary);box-shadow:12px 0 0 var(--team-accent);margin-right:12px}
`;
function apply(){
 const selected=typeof directoryState!=='undefined'?directoryState.selected:null;
 const theme=selected&&(teams[String(selected.mondayItemId)]||Object.values(teams).find(t=>t.name.toLowerCase()===String(selected.name||'').toLowerCase()));
 let style=document.getElementById('locker-team-branding-style');if(!style){style=document.createElement('style');style.id='locker-team-branding-style';style.textContent=css;document.head.appendChild(style);}
 document.body.dataset.teamThemed=String(!!theme);
 const props=['primary','accent','button','link','dark','deep','hero','end','nav','soft'];
 if(!theme){for(const p of props)document.documentElement.style.removeProperty('--team-'+p);document.querySelectorAll('.locker-team-signature').forEach(x=>x.remove());return;}
 const dark=blend(theme.primary,'#000000',.77),soft=blend(theme.primary,'#FFFFFF',.94),button=readable(theme.primary,soft),link=readable(theme.accent,'#FFFFFF');
 const values={primary:theme.primary,accent:theme.accent,button,link,dark,deep:blend(theme.primary,'#000000',.9),hero:readable(theme.primary,'#FFFFFF',false,7),end:readable(theme.accent,'#FFFFFF',false,7),nav:readable(theme.accent,dark,true,3),soft};
 for(const [p,v]of Object.entries(values))document.documentElement.style.setProperty('--team-'+p,v);
 const hero=document.querySelector('.hero');if(hero){let label=hero.querySelector('.locker-team-signature');if(!label){label=document.createElement('div');label.className='locker-team-signature';const swatch=document.createElement('i');swatch.setAttribute('aria-hidden','true');label.appendChild(swatch);label.appendChild(document.createElement('span'));hero.prepend(label);}label.querySelector('span').textContent=selected.name+' · Team Locker';}
}
const original=render;render=function(){const result=original.apply(this,arguments);apply();return result;};
window.GoatLockerBranding={apply,teams,contrast};apply();
})();
