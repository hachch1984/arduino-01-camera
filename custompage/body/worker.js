import Human from '/body/vendor/human.esm.js';

let human=null;
/** Construye la configuración explícita con modelos locales; ningún clasificador demográfico se ejecuta. */
const configuration=options=>({
  backend:'webgl',debug:false,async:false,warmup:'none',cacheModels:true,modelBasePath:'/body/models/',
  filter:{enabled:false,return:false},gesture:{enabled:true},
  face:{enabled:options.face,detector:{modelPath:'blazeface.json',maxDetected:5,return:false},
    mesh:{enabled:options.face,modelPath:'facemesh.json'},iris:{enabled:options.face,modelPath:'iris.json'},
    description:{enabled:false},emotion:{enabled:options.face&&options.emotion,modelPath:'emotion.json'},
    antispoof:{enabled:options.face&&options.liveness,modelPath:'antispoof.json'},
    liveness:{enabled:options.face&&options.liveness,modelPath:'liveness.json'},attention:{enabled:false},gear:{enabled:false}},
  body:{enabled:options.body,modelPath:'movenet-lightning.json',minConfidence:.25},
  hand:{enabled:options.hand,maxDetected:4,landmarks:true,detector:{modelPath:'handtrack.json'},skeleton:{modelPath:'handlandmark-lite.json'}},
  object:{enabled:false},segmentation:{enabled:false},
});

/** Elimina recursos que no se pueden transferir entre hilos; los puntos y scores conservan los valores de Human. */
const transferable=result=>JSON.parse(JSON.stringify({
  face:result.face.map(({tensor,gender,genderScore,race,age,embedding,...face})=>face),
  body:result.body,hand:result.hand,gesture:result.gesture,
  performance:result.performance,timestamp:result.timestamp,width:result.width,height:result.height,error:result.error,
}));

/** Recibe una sola imagen cada vez. La página espera la respuesta antes de enviar otra, evitando una cola de cuadros viejos. */
self.onmessage=async({data})=>{
  try{
    if(data.type==='init'){
      human=new Human(configuration(data.options));
      try{await human.load();}
      catch(error){
        // Equipos sin WebGL en workers siguen funcionando con CPU; se muestra el backend real en la interfaz.
        if(human.tf.getBackend()==='webgl')throw error;
        human.config.backend='cpu';await human.init();await human.load();
      }
      self.postMessage({type:'ready',backend:human.tf.getBackend(),version:human.version});
    }else if(data.type==='frame'){
      const before=performance.now();
      try{
        const result=await human.detect(data.image);
        if(result.error)throw new Error(result.error);
        self.postMessage({type:'result',result:transferable(result),elapsed:performance.now()-before});
      }finally{data.image.close();}
    }
  }catch(error){self.postMessage({type:'error',error:error.message||String(error)});}
};
