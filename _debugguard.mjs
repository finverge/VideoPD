const text = "இரண்டு லட்சத்து ஐம்பதாயிரம் ரூபாய்";
const word = "லட்சம்";
console.log("word length:", word.length);
const root = word.length > 3 ? word.slice(0, -1) : word;
console.log("root:", root);
console.log("text.toLowerCase().includes(root.toLowerCase()):", text.toLowerCase().includes(root.toLowerCase()));
console.log("text:", text);
// char by char
for (const c of word) console.log('word char:', c, c.codePointAt(0).toString(16));
console.log('---');
for (const c of text.slice(4, 11)) console.log('text char:', c, c.codePointAt(0).toString(16));
