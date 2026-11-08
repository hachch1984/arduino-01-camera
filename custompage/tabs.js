'use strict';
(() => {
  const tabs=[...document.querySelectorAll('#managementTabs [role="tab"]')];
  /** Cambia solo la visibilidad: conserva formularios, eventos, video y avisos al recorrer las pestañas. */
  const activate=selected=>{
    tabs.forEach(tab=>{
      const active=tab===selected;
      tab.classList.toggle('active',active);
      tab.setAttribute('aria-selected',String(active));
      tab.tabIndex=active?0:-1;
      const panel=document.getElementById(tab.getAttribute('aria-controls'));
      panel.hidden=!active;
      panel.classList.toggle('active',active);
      panel.classList.toggle('show',active);
    });
  };
  tabs.forEach((tab,index)=>{
    /** Selecciona una pestaña mediante ratón o activación nativa del botón con Enter/Espacio. */
    tab.onclick=()=>activate(tab);
    /** Permite recorrer el tablist con flechas, Inicio y Fin, manteniendo un único botón en el orden de tabulación. */
    tab.onkeydown=event=>{
      const next={ArrowRight:(index+1)%tabs.length,ArrowLeft:(index+tabs.length-1)%tabs.length,Home:0,End:tabs.length-1}[event.key];
      if(next===undefined)return;
      event.preventDefault();activate(tabs[next]);tabs[next].focus();
    };
  });
})();
