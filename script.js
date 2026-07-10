/* ==========================================================================
   StudyAI — script.js
   Versión final optimizada
   PDF | Word | MP3 | MP4 | Transcripción | IA
   ========================================================================== */


/* -------------------------------------------------------------------------
   1. Referencias al DOM
   ------------------------------------------------------------------------- */

const dropZone = document.getElementById("dropZone");
const fileInput = document.getElementById("fileInput");
const fileListEl = document.getElementById("fileList");
const extractionStatusEl = document.getElementById("extractionStatus");

const actionButtons = document.querySelectorAll(".action-btn");

const resultsStatus = document.getElementById("resultsStatus");
const resultsFileTag = document.getElementById("resultsFileTag");
const resultsEmpty = document.getElementById("resultsEmpty");
const resultsContent = document.getElementById("resultsContent");


/* -------------------------------------------------------------------------
   2. Estado de la aplicación
   ------------------------------------------------------------------------- */

const API_BASE = "http://localhost:3000";

let uploadedFile = null;
let extractedText = null;
let isExtracting = false;


const ACTION_LABELS = {

  transcribir: "Transcripción completa",

  resumir: "Resumen académico",

  redactar: "Redacción académica",

  cuestionario: "Cuestionario académico",

  explicar: "Explicación detallada",

  preguntas: "Preguntas y respuestas"

};


/* -------------------------------------------------------------------------
   3. Carga de archivos
   ------------------------------------------------------------------------- */


fileInput.addEventListener("change", (event)=>{

  const file = event.target.files[0];

  if(file){
    handleFile(file);
  }

});



["dragenter","dragover"].forEach(eventName=>{

  dropZone.addEventListener(eventName,(event)=>{

    event.preventDefault();

    dropZone.classList.add("is-dragover");

  });

});



["dragleave","drop"].forEach(eventName=>{

  dropZone.addEventListener(eventName,(event)=>{

    event.preventDefault();

    dropZone.classList.remove("is-dragover");

  });

});



dropZone.addEventListener("drop",(event)=>{


  const file = event.dataTransfer.files[0];


  if(file){

    handleFile(file);

  }


});




function handleFile(file){

    if (file.size > 10 * 1024 * 1024) {
        alert("El archivo supera el tamaño máximo permitido de 10 MB.");
        return;
    }

    uploadedFile = file;
    extractedText = null;

    // ...
}




function removeFile(){


  uploadedFile = null;

  extractedText = null;


  fileInput.value="";


  renderFileList();


  toggleActionButtons(false);


  resetResultsPanel();


  hideExtractionStatus();


}




function renderFileList(){


  fileListEl.innerHTML="";


  if(!uploadedFile) return;



  const item=document.createElement("li");

  item.className="file-item";



  const name=document.createElement("span");

  name.className="file-item-name";

  name.textContent =
  `${uploadedFile.name} · ${formatFileSize(uploadedFile.size)}`;



  const removeBtn=document.createElement("button");


  removeBtn.className="file-item-remove";

  removeBtn.textContent="✕";

  removeBtn.onclick=removeFile;



  item.appendChild(name);

  item.appendChild(removeBtn);



  fileListEl.appendChild(item);


}




function formatFileSize(bytes){


  if(bytes < 1024)

    return `${bytes} B`;


  if(bytes < 1024*1024)

    return `${(bytes/1024).toFixed(1)} KB`;



  return `${(bytes/(1024*1024)).toFixed(1)} MB`;


}




function toggleActionButtons(enabled){


  actionButtons.forEach(btn=>{

    btn.disabled=!enabled;

  });


}



/* -------------------------------------------------------------------------
   4. Extracción del contenido
   ------------------------------------------------------------------------- */


async function extractTextFromFile(file){


  isExtracting=true;


  showExtractionStatus(
    "Leyendo archivo...",
    "loading"
  );



  try{


    const base64File =
    await fileToBase64(file);



    const response =
    await fetch(`${API_BASE}/api/extract`,{


      method:"POST",


      headers:{


        "Content-Type":"application/json"


      },


      body:JSON.stringify({

        file:base64File,

        mimeType:file.type

      })


    });



    if(!response.ok){


      const error =
      await response.json();


      throw new Error(
        error.error || "Error leyendo archivo"
      );


    }




    const data =
    await response.json();



    extractedText=data.text;



    showExtractionStatus(
      "Contenido listo ✓",
      "ready"
    );



    toggleActionButtons(true);



    resultsStatus.textContent="listo";



  }catch(error){



    showExtractionStatus(
      error.message,
      "error"
    );


    toggleActionButtons(false);



  }finally{


    isExtracting=false;


  }


}




function showExtractionStatus(message,state){


  extractionStatusEl.hidden=false;


  extractionStatusEl.textContent=message;



  extractionStatusEl.classList.remove(
    "is-ready",
    "is-error"
  );



  if(state==="ready")

    extractionStatusEl.classList.add("is-ready");



  if(state==="error")

    extractionStatusEl.classList.add("is-error");


}




function hideExtractionStatus(){


  extractionStatusEl.hidden=true;

  extractionStatusEl.textContent="";


}
/* -------------------------------------------------------------------------
   5. Botones de acción
   ------------------------------------------------------------------------- */


actionButtons.forEach(btn=>{


  btn.addEventListener("click",()=>{


    if(!extractedText || isExtracting) return;



    actionButtons.forEach(b=>

      b.classList.remove("is-active")

    );



    btn.classList.add("is-active");



    const action = btn.dataset.action;



    runAction(action);



  });


});





async function runAction(action){



  // Mostrar transcripción directa

  if(action==="transcribir"){


    resultsStatus.textContent="completado";


    resultsEmpty.style.display="none";


    resultsContent.hidden=false;



resultsContent.innerHTML = `
<h3>${ACTION_LABELS[action]}</h3>
<pre class="ai-result">${escapeHtml(extractedText)}</pre>
`;



    return;


  }





  showLoadingState(action);




  try{


    const result =
    await processWithAI(
      action,
      extractedText
    );



    showResult(
      action,
      result
    );



  }catch(error){


    showError(error);


  }


}






/* -------------------------------------------------------------------------
   6. Renderizado de resultados
   ------------------------------------------------------------------------- */


function resetResultsPanel(){


  resultsStatus.textContent="en espera";


  resultsFileTag.textContent =
  uploadedFile ? uploadedFile.name : "—";



  resultsEmpty.style.display="flex";


  resultsContent.hidden=true;


  resultsContent.innerHTML="";



  actionButtons.forEach(btn=>{

    btn.classList.remove("is-active");

  });



}





function showLoadingState(action){


  resultsStatus.textContent="procesando";


  resultsEmpty.hidden=true;


  resultsContent.hidden=false;



  resultsContent.innerHTML=`


    <h3>${ACTION_LABELS[action]}</h3>



    <div class="results-loading">


      <span class="dot-pulse"></span>


      Generando resultado...


    </div>


  `;


}







function showResult(action,result){



  resultsStatus.textContent="completado";


  resultsEmpty.hidden=true;


  resultsContent.hidden=false;



resultsContent.innerHTML = `
<h3>${ACTION_LABELS[action]}</h3>
<pre class="ai-result">${escapeHtml(formatAIText(result))}</pre>
`;


}






function showError(error){



  resultsStatus.textContent="error";



  resultsContent.hidden=false;



  resultsContent.innerHTML=`


    <h3>No se pudo generar el resultado</h3>



    <pre class="ai-result">
${escapeHtml(error.message)}
    </pre>



  `;



}






/* -------------------------------------------------------------------------
   7. Limpieza y formato del texto IA
   ------------------------------------------------------------------------- */


function formatAIText(text){


  return text

  // elimina exceso de asteriscos markdown

  .replace(/\*\*/g,"")

  .replace(/###/g,"")

  .replace(/##/g,"")

  .trim();


}





function escapeHtml(text){


  const div=document.createElement("div");


  div.textContent=text;


  return div.innerHTML;


}







/* -------------------------------------------------------------------------
   8. Comunicación con backend
   ------------------------------------------------------------------------- */


async function processWithAI(action,text){

    const MAX_CHARS = 8000;

    if (text.length > MAX_CHARS) {
        text = text.substring(0, MAX_CHARS);
    }

    const response = await fetch(`${API_BASE}/api/process`,{


    method:"POST",


    headers:{


      "Content-Type":"application/json"


    },


    body:JSON.stringify({


      action,


      text


    })


  });






  if(!response.ok){



    const error =
    await response.json();



    throw new Error(
      error.error ||
      "Error conectando con StudyAI"
    );


  }





  const data =
  await response.json();



  return data.result;



}







/* -------------------------------------------------------------------------
   9. Convertir archivo a Base64
   ------------------------------------------------------------------------- */


function fileToBase64(file){


  return new Promise((resolve,reject)=>{


    const reader =
    new FileReader();



    reader.onload=()=>{


      resolve(
        reader.result.split(",")[1]
      );


    };



    reader.onerror=()=>{


      reject(
        "No se pudo leer el archivo"
      );


    };



    reader.readAsDataURL(file);



  });


}
