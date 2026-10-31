// Render registered notation only; opaque metadata and disabled sentinels stay
// preserved in the model without masquerading as visible playing techniques.
// Every tag is a distinct string: pull_off and pluck/pop both used to render as the same
// bare 'P', making a Live View or tab label ambiguous between "pull-off" and "slap/pop".
const FLAGS={palm_mute:'PM',fret_hand_mute:'FM',hammer_on:'H',pull_off:'P',harmonic:'◇',harmonic_pinch:'PH',tap:'T',slap:'SLP',pluck:'POP',tremolo:'TR',accent:'>',ignore:'I',link_next:'L'};
export function techniqueEnabled(note,key){const t=note?.techniques||{},active=value=>value===true||typeof value==='number'&&value>0;return active(t[key])||(key==='fret_hand_mute'&&active(t.mute));}
export function setTechniqueFlag(note,key,enabled){note.techniques||={};note.techniques[key]=Boolean(enabled);if(key==='fret_hand_mute'&&Object.hasOwn(note.techniques,'mute'))note.techniques.mute=Boolean(enabled);}
export function techniqueTags(note){
 const t=note?.techniques||{},tags=[];
 for(const [key,label]of Object.entries(FLAGS))if(techniqueEnabled(note,key))tags.push(label);
 if(t.vibrato===true||typeof t.vibrato==='number'&&t.vibrato>0)tags.push('~');
 if(t.bend>0||(t.bend_values||[]).some?.(point=>point?.v>0))tags.push('↗');
 if(Number.isInteger(t.slide_to)&&t.slide_to>=0)tags.push('SL');
 if(Number.isInteger(t.slide_unpitch_to)&&t.slide_unpitch_to>=0)tags.push('US');
 if(t.force_destination_pitch===1)tags.push('Dest on');else if(t.force_destination_pitch===2)tags.push('Dest off');
 return tags;
}
