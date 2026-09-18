/* Synchronous local appearance restore before the application paints. No weather data. */
(()=>{const colors={day:'#d5e5ee',dawn:'#d2dae6',dusk:'#34405e',night:'#101c36'};try{const phase=localStorage.getItem('zindycast.sky-phase.v1');if(colors[phase]){document.documentElement.dataset.bootSky=phase;document.documentElement.style.setProperty('--boot-sky',colors[phase]);}}catch{}})();
