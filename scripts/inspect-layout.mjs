import { chromium } from '@playwright/test';
const browser=await chromium.launch({headless:true});
try {
 const page=await browser.newPage({viewport:{width:390,height:844}});
 for(const route of ['/','/calendar','/approvals','/leads','/automations','/assets','/reports','/settings']){
  await page.goto('http://127.0.0.1:3100'+route);await page.getByRole('heading',{level:1}).waitFor();
  const layout=await page.evaluate(()=>({width:innerWidth,scroll:document.documentElement.scrollWidth,overflow:[...document.querySelectorAll('main *')].filter(el=>el.getBoundingClientRect().right>innerWidth+1).map(el=>({tag:el.tagName,class:el.className,right:Math.round(el.getBoundingClientRect().right)})).slice(0,12)}));
  console.log(JSON.stringify({route,...layout}));
 }
}finally{await browser.close();}
