const SAMPLE_CONVERSATIONS=[{title:"Respiratory case",body:`Patient: I've had a fever and a dry cough for three days.
Doctor: Any shortness of breath or chest pain?
Patient: Mild shortness of breath when climbing stairs.
Doctor: Any chronic conditions?
Patient: No, generally healthy.
Doctor: I'll record suspected viral respiratory infection and order tests.`},{title:"Diabetes follow-up",body:`Patient: I'm here for my diabetes check-up.
Doctor: How have your glucose readings been?
Patient: Mostly between 180 and 220.
Doctor: Any dizziness or vision issues?
Patient: Slight blurred vision in the evening.
Doctor: We'll note uncontrolled glucose levels and adjust medication.`},{title:"Pediatric headache",body:`Parent: My child has been complaining of headaches.
Doctor: Any nausea or vomiting?
Parent: Mild nausea yesterday.
Doctor: Any recent injuries?
Parent: No.
Doctor: We'll log tension-type headache and recommend hydration and rest.`}];

let currentPdfBytes=null;
let currentFieldNames=[];
let filledPdfBytes=null;

const pdfInput=document.getElementById("pdf-upload");
const pdfName=document.getElementById("pdf-name");
const fieldCount=document.getElementById("field-count");
const fieldList=document.getElementById("field-list");
const fieldBadge=document.getElementById("field-badge");
const conversationInput=document.getElementById("conversation-input");
const sampleGrid=document.getElementById("sample-grid");
const runButton=document.getElementById("run-fill");
const downloadButton=document.getElementById("download-filled");
const resultList=document.getElementById("result-list");
const jsonOutput=document.getElementById("json-output");
const mappedCount=document.getElementById("mapped-count");
const missingCount=document.getElementById("missing-count");
const confidenceMix=document.getElementById("confidence-mix");
const runStatus=document.getElementById("run-status");
const clearConversationBtn=document.getElementById("clear-conversation");

function initSamples(){
  SAMPLE_CONVERSATIONS.forEach(sample=>{
    const card=document.createElement("button");
    card.type="button";
    card.className="sample-card";
    card.innerHTML=`<strong>${sample.title}</strong><p>${sample.body.slice(0,130)}...</p>`;
    card.addEventListener("click",()=>{conversationInput.value=sample.body;});
    sampleGrid.appendChild(card);
  });
}

function setStatus(text,type="idle"){
  runStatus.textContent=text;
  runStatus.style.background=type==="error"?"rgba(255,92,122,0.2)":"rgba(22,224,189,0.12)";
  runStatus.style.color=type==="error"?"#ff9bb0":"#7debd8";
}

function renderFieldList(names){
  if(!names.length){
    fieldList.classList.add("empty-state");
    fieldList.textContent="No fillable fields detected.";
    fieldBadge.textContent="No fields";
    return;
  }
  fieldList.classList.remove("empty-state");
  fieldList.innerHTML="";
  names.forEach(name=>{
    const chip=document.createElement("div");
    chip.className="field-chip";
    chip.textContent=name;
    fieldList.appendChild(chip);
  });
  fieldBadge.textContent=`${names.length} fields`;
}

async function loadPdfFromFile(file){
  const arrayBuffer=await file.arrayBuffer();
  currentPdfBytes=new Uint8Array(arrayBuffer);
  await inspectPdf();
}

async function inspectPdf(){
  if(!currentPdfBytes)return;
  try{
    const pdfDoc=await PDFLib.PDFDocument.load(currentPdfBytes);
    const form=pdfDoc.getForm();
    const fields=form.getFields();
    currentFieldNames=fields.map(field=>field.getName());
    fieldCount.textContent=String(currentFieldNames.length);
    renderFieldList(currentFieldNames);
    setStatus("PDF loaded");
  }catch(e){
    console.error(e);
    alert("Failed to read PDF fields. Ensure the form is fillable (AcroForm).");
    setStatus("PDF error","error");
  }
}

async function callApplicationAI(){
  const conversation=conversationInput.value.toLowerCase();
  const mapping={};
  currentFieldNames.forEach(field=>{
    const normalized=field.toLowerCase();
    let value=null;
    if(normalized.includes("symptom")||normalized.includes("complaint")){
      if(conversation.includes("cough"))value="Fever, dry cough, mild shortness of breath";
      else if(conversation.includes("glucose")||conversation.includes("diabetes"))value="Elevated glucose readings and blurred vision";
      else if(conversation.includes("headache"))value="Headache with mild nausea";
    }else if(normalized.includes("diagnosis")||normalized.includes("assessment")){
      if(conversation.includes("cough"))value="Suspected viral respiratory infection";
      else if(conversation.includes("diabetes"))value="Uncontrolled diabetes follow-up";
      else if(conversation.includes("headache"))value="Possible tension-type headache";
    }else if(normalized.includes("plan")||normalized.includes("treatment")){
      if(conversation.includes("test"))value="Order diagnostic tests and follow-up";
      else if(conversation.includes("medication"))value="Adjust medication and monitor glucose";
      else value="Clinical follow-up as needed";
    }else if(normalized.includes("name")){
      value=null;
    }
    mapping[field]={value,confidence:value?0.82:0.2};
  });
  return {fields:mapping,note:"Demo local mapper. Production API orchestration should be handled inside the application backend."};
}

function renderResult(mapping){
  const entries=Object.entries(mapping);
  resultList.innerHTML="";
  if(!entries.length){
    resultList.classList.add("empty-state");
    resultList.textContent="No mapped fields returned.";
    mappedCount.textContent="0";
    missingCount.textContent="0";
    confidenceMix.textContent="n/a";
    return;
  }
  resultList.classList.remove("empty-state");
  let mapped=0,missing=0;
  const confidences=[];
  entries.forEach(([field,meta])=>{
    const item=document.createElement("div");
    item.className="result-item";
    const value=meta&&meta.value!==undefined?meta.value:null;
    const confidence=meta&&typeof meta.confidence==="number"?meta.confidence:null;
    if(value!==null&&value!==""&&value!==undefined)mapped+=1;else missing+=1;
    if(confidence!==null)confidences.push(confidence);
    item.innerHTML=`<strong>${field}</strong><span>${value??"—"}</span><small>confidence: ${confidence??"n/a"}</small>`;
    resultList.appendChild(item);
  });
  mappedCount.textContent=String(mapped);
  missingCount.textContent=String(missing);
  confidenceMix.textContent=confidences.length?`avg ${((confidences.reduce((a,b)=>a+b,0)/confidences.length)*100).toFixed(0)}%`:"n/a";
}

async function fillPdfWithMapping(mapping){
  const pdfDoc=await PDFLib.PDFDocument.load(currentPdfBytes);
  const form=pdfDoc.getForm();
  Object.entries(mapping).forEach(([fieldName,meta])=>{
    const value=meta&&meta.value!==undefined?meta.value:null;
    if(value===null||value===undefined)return;
    try{form.getTextField(fieldName).setText(String(value));}
    catch(e){console.warn("Unable to set text field",fieldName,e);}
  });
  form.updateFieldAppearances();
  return await pdfDoc.save();
}

async function run(){
  if(!currentPdfBytes){alert("Upload a PDF form first.");return;}
  if(!conversationInput.value.trim()){alert("Provide a conversation.");return;}
  setStatus("AI mapping…");
  runButton.disabled=true;
  downloadButton.disabled=true;
  try{
    const parsed=await callApplicationAI();
    const mapping=parsed.fields||{};
    jsonOutput.textContent=JSON.stringify(parsed,null,2);
    renderResult(mapping);
    filledPdfBytes=await fillPdfWithMapping(mapping);
    downloadButton.disabled=false;
    setStatus("Completed");
  }catch(e){
    console.error(e);
    alert(e.message);
    setStatus("Error","error");
  }finally{
    runButton.disabled=false;
  }
}

function downloadPdf(){
  if(!filledPdfBytes)return;
  const blob=new Blob([filledPdfBytes],{type:"application/pdf"});
  const url=URL.createObjectURL(blob);
  const a=document.createElement("a");
  a.href=url;
  a.download="filled-medical-form.pdf";
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
}

pdfInput.addEventListener("change",e=>{
  const file=e.target.files&&e.target.files[0];
  if(file){pdfName.textContent=file.name;loadPdfFromFile(file);}
});
runButton.addEventListener("click",run);
downloadButton.addEventListener("click",downloadPdf);
clearConversationBtn.addEventListener("click",()=>{conversationInput.value="";});
initSamples();
