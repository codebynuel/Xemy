const CREDITS_FREE    = parseInt(process.env.CREDITS_FREE)    || 150;
const CREDITS_STARTER = parseInt(process.env.CREDITS_STARTER) || 1500;
const CREDITS_PRO     = parseInt(process.env.CREDITS_PRO)     || 5000;

const COST_TEXT_TO_3D        = parseInt(process.env.COST_TEXT_TO_3D)        || 50;
const COST_IMAGE_TO_3D       = parseInt(process.env.COST_IMAGE_TO_3D)      || 50;
const COST_MULTI_IMAGE_TO_3D = parseInt(process.env.COST_MULTI_IMAGE_TO_3D) || 75;
const COST_TEXTURE           = parseInt(process.env.COST_TEXTURE)           || 15;

const PLAN_CREDITS = { free: CREDITS_FREE, starter: CREDITS_STARTER, pro: CREDITS_PRO, enterprise: Infinity };

const PUBLIC_URL = process.env.PUBLIC_URL;
const LOCAL_URL  = process.env.LOCAL_URL;

module.exports = {
    CREDITS_FREE, CREDITS_STARTER, CREDITS_PRO,
    COST_TEXT_TO_3D, COST_IMAGE_TO_3D, COST_MULTI_IMAGE_TO_3D, COST_TEXTURE,
    PLAN_CREDITS,
    PUBLIC_URL, LOCAL_URL
};
