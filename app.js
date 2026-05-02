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
Doctor: We'll log tension-type headache and recommend hydration and rest.`}];const DEFAULT_PROMPT=`You are a medical form filling assistant.

You will receive:
1. A list of PDF form fields.
2. A doctor-patient conversation.

Your task:
- Map relevant information from the conversation into the provided fields.
- Only fill a field if the value is clearly supported by the conversation.
- If a field cannot be confidently filled, set its value to null.

Return strict JSON in this shape:
{
  "fields": {
    "<field_name>": { "value": string | null, "confidence": number }
  }
}

Confidence is between 0 and 1.

PDF Fields:
{{fields}}

Conversation:
{{conversation}}`;let currentPdfBytes=null;let currentFieldNames=[];let filledPdfBytes=null;const pdfInput=document.getElementById("pdf-upload");const pdfName=document.getElementById("pdf-name");const fieldCount=document.getElementById("field-count");const fieldList=document.getElementById("field-list");const fieldBadge=document.getElementById("field-badge");const conversationInput=document.getElementById("conversation-input");const sampleGrid=document.getElementById("sample-grid");const apiKeyInput=document.getElementById("api-key");const modelInput=document.getElementById("model-input");const promptTemplate=document.getElementById("prompt-template");const runButton=document.getElementById("run-fill");const downloadButton=document.getElementById("download-filled");const resultList=document.getElementById("result-list");const jsonOutput=document.getElementById("json-output");const mappedCount=document.getElementById("mapped-count");const missingCount=document.getElementById("missing-count");const confidenceMix=document.getElementById("confidence-mix");const runStatus=document.getElementById("run-status");const clearConversationBtn=document.getElementById("clear-conversation");const resetPromptBtn=document.getElementById("reset-prompt");const useDemoFormBtn=document.getElementById("use-demo-form");function initSamples(){SAMPLE_CONVERSATIONS.forEach(sample=>{const card=document.createElement("button");card.type="button";card.className="sample-card";card.innerHTML=`<strong>${sample.title}</strong><p>${sample.body.slice(0,120)}...</p>`;card.addEventListener("click",()=>{conversationInput.value=sample.body;});sampleGrid.appendChild(card);});}function setStatus(text,type="idle"){runStatus.textContent=text;runStatus.style.background=type==="error"?"rgba(255,92,122,0.2)":"rgba(22,224,189,0.12)";runStatus.style.color=type==="error"?"#ff9bb0":"#7debd8";}function renderFieldList(names){if(!names.length){fieldList.classList.add("empty-state");fieldList.textContent="No fillable fields detected.";fieldBadge.textContent="No fields";return;}fieldList.classList.remove("empty-state");fieldList.innerHTML="";names.forEach(name=>{const chip=document.createElement("div");chip.className="field-chip";chip.textContent=name;fieldList.appendChild(chip);});fieldBadge.textContent=`${names.length} fields`;}
async function loadPdfFromFile(file){const arrayBuffer=await file.arrayBuffer();currentPdfBytes=new Uint8Array(arrayBuffer);await inspectPdf();}
async function loadDemoPdf(){const response=await fetch("./sample-medical-form.pdf");if(!response.ok){alert("Demo PDF not found in repo. Upload your own form.");return;}const arrayBuffer=await response.arrayBuffer();currentPdfBytes=new Uint8Array(arrayBuffer);pdfName.textContent="sample-medical-form.pdf";await inspectPdf();}
async function inspectPdf(){if(!currentPdfBytes){return;}try{const pdfDoc=await PDFLib.PDFDocument.load(currentPdfBytes);const form=pdfDoc.getForm();const fields=form.getFields();currentFieldNames=fields.map(field=>field.getName());fieldCount.textContent=String(currentFieldNames.length);renderFieldList(currentFieldNames);setStatus("PDF loaded");}catch(e){console.error(e);alert("Failed to read PDF fields. Ensure the form is fillable (AcroForm).");setStatus("PDF error","error");}}
function buildPrompt(){const template=promptTemplate.value||DEFAULT_PROMPT;const fieldsString=currentFieldNames.join(", ");const conversation=conversationInput.value.trim();return template.replace("{{fields}}",fieldsString).replace("{{conversation}}",conversation);} 
async function callOpenAI(prompt){const apiKey=apiKeyInput.value.trim();if(!apiKey){throw new Error("Missing OpenAI API key");}const model=modelInput.value.trim()||"gpt-4o-mini";const response=await fetch("https://api.openai.com/v1/responses",{method:"POST",headers:{"Content-Type":"application/json","Authorization":`Bearer ${apiKey}`},body:JSON.stringify({model,input:prompt,response_format:{type:"json_object"}})});if(!response.ok){const text=await response.text();throw new Error(`OpenAI API error: ${text}`);}const data=await response.json();let outputText="";if(Array.isArray(data.output)&&data.output.length){const first=data.output[0];if(first.content&&first.content.length){const part=first.content.find(c=>c.type==="output_text");if(part){outputText=part.text;}}}
if(!outputText&&data.output_text){outputText=data.output_text;}if(!outputText){throw new Error("No output text returned from OpenAI response.");}return outputText;}
function safeParse(jsonText){try{return JSON.parse(jsonText);}catch(e){console.warn("JSON parse failed, attempting to fix",e);const cleaned=jsonText.replace(/```json/g,"").replace(/```/g,"");return JSON.parse(cleaned);}}
function renderResult(mapping){const entries=Object.entries(mapping);resultList.innerHTML="";if(!entries.length){resultList.classList.add("empty-state");resultList.textContent="No mapped fields returned.";mappedCount.textContent="0";missingCount.textContent="0";confidenceMix.textContent="n/a";return;}resultList.classList.remove("empty-state");let mapped=0;let missing=0;let confidences=[];entries.forEach(([field,meta])=>{const item=document.createElement("div");item.className="result-item";const value=meta&&meta.value!==undefined?meta.value:null;const confidence=meta&&typeof meta.confidence==="number"?meta.confidence:null;if(value!==null&&value!==""&&value!==undefined){mapped+=1;}else{missing+=1;}if(confidence!==null){confidences.push(confidence);}item.innerHTML=`<strong>${field}</strong><span>${value??"—"}</span><small>confidence: ${confidence??"n/a"}</small>`;resultList.appendChild(item);});mappedCount.textContent=String(mapped);missingCount.textContent=String(missing);if(confidences.length){const avg=confidences.reduce((a,b)=>a+b,0)/confidences.length;confidenceMix.textContent=`avg ${(avg*100).toFixed(0)}%`;}else{confidenceMix.textContent="n/a";}}
async function fillPdfWithMapping(mapping){if(!currentPdfBytes){return null;}const pdfDoc=await PDFLib.PDFDocument.load(currentPdfBytes);const form=pdfDoc.getForm();Object.entries(mapping).forEach(([fieldName,meta])=>{const value=meta&&meta.value!==undefined?meta.value:null;if(value===null||value===undefined){return;}try{const field=form.getTextField(fieldName);field.setText(String(value));}catch(e){try{const field=form.getField(fieldName);if(field&&field.setText){field.setText(String(value));}}catch(err){console.warn("Unable to set field",fieldName,err);}}});form.updateFieldAppearances();const bytes=await pdfDoc.save();return bytes;}
async function run(){if(!currentPdfBytes){alert("Upload or load a PDF form first.");return;}if(!conversationInput.value.trim()){alert("Provide a conversation.");return;}setStatus("Calling OpenAI…");runButton.disabled=true;downloadButton.disabled=true;try{const prompt=buildPrompt();const raw=await callOpenAI(prompt);jsonOutput.textContent=raw;const parsed=safeParse(raw);const mapping=parsed.fields||{};renderResult(mapping);const filled=await fillPdfWithMapping(mapping);filledPdfBytes=filled;if(filled){downloadButton.disabled=false;}setStatus("Completed");}catch(e){console.error(e);alert(e.message);setStatus("Error","error");}finally{runButton.disabled=false;}}
function downloadPdf(){if(!filledPdfBytes){return;}const blob=new Blob([filledPdfBytes],{type:"application/pdf"});const url=URL.createObjectURL(blob);const a=document.createElement("a");a.href=url;a.download="filled-medical-form.pdf";document.body.appendChild(a);a.click();a.remove();URL.revokeObjectURL(url);} 
pdfInput.addEventListener("change",e=>{const file=e.target.files&&e.target.files[0];if(file){pdfName.textContent=file.name;loadPdfFromFile(file);}});runButton.addEventListener("click",run);downloadButton.addEventListener("click",downloadPdf);clearConversationBtn.addEventListener("click",()=>{conversationInput.value="";});resetPromptBtn.addEventListener("click",()=>{promptTemplate.value=DEFAULT_PROMPT;});useDemoFormBtn.addEventListener("click",loadDemoPdf);promptTemplate.value=DEFAULT_PROMPT;initSamples();