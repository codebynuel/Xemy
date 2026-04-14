const fs = require('fs');
const path = require('path');

const THUMB_DIR = path.join(__dirname, '../../../temp_models/_thumbnails');

async function generateImageFromText(prompt) {
    const FAL_KEY = process.env.FAL_KEY;
    if (!FAL_KEY) throw new Error('FAL_KEY not configured');

    const submitRes = await fetch(process.env.FLUX_URI, {
        method: 'POST',
        headers: {
            'Authorization': `Key ${FAL_KEY}`,
            'Content-Type': 'application/json'
        },
        body: JSON.stringify({ prompt, image_size: 'square_hd', num_images: 1 })
    });
    const submitData = await submitRes.json();

    if (submitData.images?.[0]?.url) return submitData.images[0].url;

    const statusUrl = submitData.status_url;
    const responseUrl = submitData.response_url;
    if (!statusUrl || !responseUrl) throw new Error('ai did not return queue URLs');

    for (let i = 0; i < 60; i++) {
        await new Promise(r => setTimeout(r, 2000));
        const pollRes = await fetch(statusUrl, { headers: { 'Authorization': `Key ${FAL_KEY}` } });
        const pollData = await pollRes.json();
        if (pollData.status === 'COMPLETED') break;
        if (pollData.status === 'FAILED') throw new Error('FLUX image generation failed');
    }

    const resultRes = await fetch(responseUrl, { headers: { 'Authorization': `Key ${FAL_KEY}` } });
    const resultData = await resultRes.json();
    const imageUrl = resultData.images?.[0]?.url;
    if (!imageUrl) throw new Error('FLUX returned no image');
    return imageUrl;
}

async function downloadImageAsThumb(imageUrl, generationId) {
    try {
        const res = await fetch(imageUrl);
        if (!res.ok) return '';
        const buffer = Buffer.from(await res.arrayBuffer());
        const ext = imageUrl.includes('.png') ? '.png' : '.jpg';
        const thumbFileName = `${generationId}${ext}`;
        const thumbPath = path.join(THUMB_DIR, thumbFileName);
        fs.writeFileSync(thumbPath, buffer);
        return `/thumbnails/${thumbFileName}`;
    } catch (err) {
        console.error('Thumbnail download failed:', err);
        return '';
    }
}

module.exports = { generateImageFromText, downloadImageAsThumb };
