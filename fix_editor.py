import re

with open('editor.js', 'r') as f:
    content = f.read()

# Find the bind function's videoInput handler
old_str = "$('addSegment').onclick=addSegment"
new_str = "$('addSegment').onclick=addSegment;$('enhanceVideo').onclick=enhanceVideo"

if old_str in content:
    content = content.replace(old_str, new_str, 1)
    print("Added enhanceVideo click handler")
else:
    print("Could not find target string")

# Add the enhanceVideo function before bind function
enhance_func = '''  const enhanceVideo=async()=>{if(!state.videoId){toast('Upload a video first to enhance it.');return}const preset=$('enhancePreset').value;$('enhanceStatus').textContent='Enhancing video...';$('enhanceVideo').disabled=true;try{const r=await api('/api/enhance',{method:'POST',body:JSON.stringify({videoId:state.videoId,presetType:preset})});$('enhanceStatus').textContent='Video enhanced successfully!';toast('Video enhanced successfully!');state.videoId=r.id;state.video.url=r.url;state.video.name='Enhanced Video';$('sourceVideo').src=r.url;toast('Enhanced video loaded. You can now use it in your project.');$('enhanceStatus').textContent='Enhanced video loaded.'}catch(e){$('enhanceStatus').textContent='Enhancement failed: '+e.message;toast('Enhancement failed: '+e.message)}finally{$('enhanceVideo').disabled=false}};
  const bind=()=>{'''

old_bind = "  const bind=()=>{"
if old_bind in content:
    content = content.replace(old_bind, enhance_func, 1)
    print("Added enhanceVideo function")
else:
    print("Could not find bind function")

with open('editor.js', 'w') as f:
    f.write(content)

print("Done")
