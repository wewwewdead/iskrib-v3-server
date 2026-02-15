import supabase from "./supabase.js";

const FREEDOM_WALL_ITEM_TYPES = ["doodle", "sticker", "stamp", "note"];
const DEFAULT_ITEMS_LIMIT = 200;
const MAX_ITEMS_LIMIT = 400;
const NOTE_FONT_STYLES = ["normal", "bold", "italic"];
const NOTE_FONT_FAMILIES = [
    "Georgia",
    "Courier New",
    "Trebuchet MS",
    "Arial",
    "Times New Roman"
];

const clamp = (value, min, max) => Math.min(Math.max(value, min), max);

const parseLimit = (limit) => {
    const parsedLimit = Number(limit ?? DEFAULT_ITEMS_LIMIT);
    if(Number.isNaN(parsedLimit) || parsedLimit < 1 || parsedLimit > MAX_ITEMS_LIMIT){
        throw {status: 400, error: `limit should be an integer between 1 and ${MAX_ITEMS_LIMIT}`};
    }
    return Math.floor(parsedLimit);
};

const parseTypeFilters = (types) => {
    if(!types){
        return [];
    }

    const parsedTypes = String(types)
        .split(",")
        .map((value) => value.trim().toLowerCase())
        .filter(Boolean);

    const uniqueTypes = [...new Set(parsedTypes)].filter((type) => FREEDOM_WALL_ITEM_TYPES.includes(type));
    return uniqueTypes;
};

const parseColor = (value, fallback) => {
    if(typeof value !== "string"){
        return fallback;
    }

    const trimmed = value.trim();
    if(!trimmed){
        return fallback;
    }

    return trimmed;
};

const normalizeNumber = (value, fallback) => {
    const parsedValue = Number(value);
    if(Number.isNaN(parsedValue)){
        return fallback;
    }
    return parsedValue;
};

const normalizePosition = (value, fallback) => clamp(normalizeNumber(value, fallback), 0, 1);

const sanitizeDoodlePayload = (payload) => {
    const points = Array.isArray(payload?.points)
        ? payload.points
            .map((point) => Number(point))
            .filter((point) => !Number.isNaN(point))
            .map((point) => clamp(point, 0, 1))
        : [];

    if(points.length < 4){
        throw {status: 400, error: "doodle payload points must contain at least 2 coordinate pairs"};
    }

    const sanitizedPoints = points.length % 2 === 0
        ? points
        : points.slice(0, -1);

    const normalizedSize = clamp(normalizeNumber(payload?.size, 2.8), 1, 24);
    return {
        points: sanitizedPoints,
        color: parseColor(payload?.color, "#5f92ff"),
        size: normalizedSize,
        // Backward compatibility for older DB check constraints that still expect strokeWidth.
        strokeWidth: normalizedSize
    };
};

const sanitizeStickerPayload = (payload) => {
    const sticker = typeof payload?.sticker === "string" ? payload.sticker.trim() : "";
    const stickerId = typeof payload?.stickerId === "string" ? payload.stickerId.trim() : "";
    if(!sticker && !stickerId){
        throw {status: 400, error: "sticker payload requires sticker or stickerId"};
    }

    const result = {
        x: normalizePosition(payload?.x, 0.5),
        y: normalizePosition(payload?.y, 0.5),
        scale: clamp(normalizeNumber(payload?.scale, 1), 0.25, 6),
        rotation: clamp(normalizeNumber(payload?.rotation, 0), -360, 360)
    };

    if(sticker){
        result.sticker = sticker;
    } else {
        result.stickerId = stickerId;
    }

    return result;
};

const sanitizeStampPayload = (payload) => {
    const stamp = typeof payload?.stamp === "string" ? payload.stamp.trim() : "";
    if(!stamp){
        throw {status: 400, error: "stamp payload requires stamp"};
    }

    return {
        stamp: stamp,
        x: normalizePosition(payload?.x, 0.5),
        y: normalizePosition(payload?.y, 0.5),
        scale: clamp(normalizeNumber(payload?.scale, 1), 0.35, 5),
        rotation: clamp(normalizeNumber(payload?.rotation, 0), -360, 360)
    };
};

const sanitizeNotePayload = (payload) => {
    const text = typeof payload?.text === "string" ? payload.text.trim() : "";
    if(!text){
        throw {status: 400, error: "note payload requires text"};
    }

    const requestedFontFamily = typeof payload?.fontFamily === "string" ? payload.fontFamily.trim() : "";
    const requestedFontStyle = typeof payload?.fontStyle === "string" ? payload.fontStyle.trim().toLowerCase() : "";

    return {
        text: text.slice(0, 800),
        x: normalizePosition(payload?.x, 0.45),
        y: normalizePosition(payload?.y, 0.45),
        width: clamp(normalizeNumber(payload?.width, 0.26), 0.12, 0.9),
        height: clamp(normalizeNumber(payload?.height, 0.2), 0.1, 0.8),
        rotation: clamp(normalizeNumber(payload?.rotation, 0), -360, 360),
        fontFamily: NOTE_FONT_FAMILIES.includes(requestedFontFamily) ? requestedFontFamily : "Arial",
        fontStyle: NOTE_FONT_STYLES.includes(requestedFontStyle) ? requestedFontStyle : "normal",
        fontColor: parseColor(payload?.fontColor, "#1f2937"),
        bgColor: parseColor(payload?.bgColor, "#fff4a8"),
        fontSize: clamp(normalizeNumber(payload?.fontSize, 16), 10, 64)
    };
};

const sanitizePayloadByType = (itemType, payload) => {
    if(!payload || typeof payload !== "object" || Array.isArray(payload)){
        throw {status: 400, error: "payload should be an object"};
    }

    if(itemType === "doodle"){
        return sanitizeDoodlePayload(payload);
    }
    if(itemType === "sticker"){
        return sanitizeStickerPayload(payload);
    }
    if(itemType === "stamp"){
        return sanitizeStampPayload(payload);
    }
    if(itemType === "note"){
        return sanitizeNotePayload(payload);
    }

    throw {status: 400, error: "invalid freedom wall item type"};
};

const throwMappedDatabaseError = (error, fallbackErrorMessage) => {
    const code = String(error?.code || "");
    const message = error?.message || fallbackErrorMessage;
    const details = error?.details || "";

    if(code === "23514"){
        throw {
            status: 400,
            error: `database check constraint rejected payload: ${message}${details ? ` (${details})` : ""}`
        };
    }

    if(code === "22P02"){
        throw {status: 400, error: "invalid uuid or malformed value in request"};
    }

    throw {status: 500, error: fallbackErrorMessage};
};

const assertActiveWeek = async(weekId) => {
    const {data: week, error: weekError} = await supabase
        .from("freedom_wall_weeks")
        .select("id, week_start, week_end, status")
        .eq("id", weekId)
        .maybeSingle();

    if(weekError){
        console.error("supabase error while reading freedom wall week:", weekError.message);
        throw {status: 500, error: "failed to read freedom wall week"};
    }

    if(!week?.id){
        throw {status: 404, error: "freedom wall week not found"};
    }

    const nowIso = new Date().toISOString();
    if(week.status !== "active" || nowIso < week.week_start || nowIso >= week.week_end){
        throw {status: 409, error: "freedom wall week is not active"};
    }

    return week;
};

const selectItemColumns = `
    id,
    week_id,
    user_id,
    item_type,
    payload,
    z_index,
    created_at,
    updated_at,
    deleted_at,
    users(id, name, image_url, badge)
`;

export const getCurrentFreedomWallWeekService = async() => {
    let {data: activeWeek, error: activeWeekError} = await supabase
        .from("freedom_wall_weeks")
        .select("*")
        .eq("status", "active")
        .order("week_start", {ascending: false})
        .limit(1)
        .maybeSingle();

    if(activeWeekError){
        console.error("supabase error while reading active freedom wall week:", activeWeekError.message);
        throw {status: 500, error: "failed to fetch active freedom wall week"};
    }

    if(!activeWeek){
        const {error: rotateError} = await supabase.rpc("rotate_freedom_wall_week");
        if(rotateError){
            console.error("rotate_freedom_wall_week rpc error:", rotateError.message);
        }

        const retry = await supabase
            .from("freedom_wall_weeks")
            .select("*")
            .eq("status", "active")
            .order("week_start", {ascending: false})
            .limit(1)
            .maybeSingle();

        activeWeek = retry.data;
        activeWeekError = retry.error;
    }

    if(activeWeekError){
        console.error("supabase error while reading active freedom wall week:", activeWeekError.message);
        throw {status: 500, error: "failed to fetch active freedom wall week"};
    }

    if(!activeWeek){
        throw {status: 404, error: "no active freedom wall week found"};
    }

    return {week: activeWeek};
};

export const getFreedomWallItemsService = async(weekId, limit, cursor, types) => {
    if(!weekId){
        throw {status: 400, error: "weekId is required"};
    }

    const parsedLimit = parseLimit(limit);
    const typeFilters = parseTypeFilters(types);

    let query = supabase
        .from("freedom_wall_items")
        .select(selectItemColumns)
        .eq("week_id", weekId)
        .is("deleted_at", null)
        .order("z_index", {ascending: true})
        .order("created_at", {ascending: true})
        .order("id", {ascending: true})
        .limit(parsedLimit + 1);

    if(cursor){
        query = query.gt("created_at", cursor);
    }

    if(typeFilters.length > 0){
        query = query.in("item_type", typeFilters);
    }

    const {data: items, error: itemsError} = await query;

    if(itemsError){
        console.error("supabase error while reading freedom wall items:", itemsError.message);
        throw {status: 500, error: "failed to fetch freedom wall items"};
    }

    const hasMore = (items || []).length > parsedLimit;
    const slicedItems = hasMore ? items.slice(0, parsedLimit) : (items || []);
    const nextCursor = hasMore
        ? slicedItems[slicedItems.length - 1]?.created_at || null
        : null;

    return {
        data: slicedItems,
        hasMore: hasMore,
        nextCursor: nextCursor
    };
};

export const createFreedomWallItemService = async({weekId, itemType, payload, zIndex = 0, userId}) => {
    if(!userId){
        throw {status: 401, error: "not authorized"};
    }

    if(!weekId){
        throw {status: 400, error: "weekId is required"};
    }

    const normalizedType = typeof itemType === "string" ? itemType.trim().toLowerCase() : "";
    if(!FREEDOM_WALL_ITEM_TYPES.includes(normalizedType)){
        throw {status: 400, error: "invalid freedom wall item type"};
    }

    await assertActiveWeek(weekId);

    const sanitizedPayload = sanitizePayloadByType(normalizedType, payload);
    const parsedZIndex = clamp(normalizeNumber(zIndex, 0), -100000, 100000);

    const {data: createdItem, error: createError} = await supabase
        .from("freedom_wall_items")
        .insert({
            week_id: weekId,
            user_id: userId,
            item_type: normalizedType,
            payload: sanitizedPayload,
            z_index: parsedZIndex
        })
        .select(selectItemColumns)
        .single();

    if(createError){
        console.error("supabase error while creating freedom wall item:", createError.message);
        throwMappedDatabaseError(createError, "failed to create freedom wall item");
    }

    return {item: createdItem};
};

export const updateFreedomWallItemService = async({itemId, payload, zIndex, userId}) => {
    if(!userId){
        throw {status: 401, error: "not authorized"};
    }

    if(!itemId){
        throw {status: 400, error: "itemId is required"};
    }

    if(payload === undefined && zIndex === undefined){
        throw {status: 400, error: "payload or zIndex is required"};
    }

    const {data: existingItem, error: existingItemError} = await supabase
        .from("freedom_wall_items")
        .select("id, week_id, user_id, item_type, payload, z_index")
        .eq("id", itemId)
        .is("deleted_at", null)
        .maybeSingle();

    if(existingItemError){
        console.error("supabase error while reading freedom wall item:", existingItemError.message);
        throw {status: 500, error: "failed to read freedom wall item"};
    }

    if(!existingItem?.id){
        throw {status: 404, error: "freedom wall item not found"};
    }

    if(String(existingItem.user_id) !== String(userId)){
        throw {status: 403, error: "not allowed to edit this freedom wall item"};
    }

    await assertActiveWeek(existingItem.week_id);

    const updatePayload = {};
    if(payload !== undefined){
        const mergedPayload = {
            ...(existingItem.payload || {}),
            ...(payload || {})
        };
        updatePayload.payload = sanitizePayloadByType(existingItem.item_type, mergedPayload);
    }

    if(zIndex !== undefined){
        updatePayload.z_index = clamp(normalizeNumber(zIndex, existingItem.z_index || 0), -100000, 100000);
    }

    const {data: updatedItem, error: updateError} = await supabase
        .from("freedom_wall_items")
        .update(updatePayload)
        .eq("id", itemId)
        .select(selectItemColumns)
        .single();

    if(updateError){
        console.error("supabase error while updating freedom wall item:", updateError.message);
        throwMappedDatabaseError(updateError, "failed to update freedom wall item");
    }

    return {item: updatedItem};
};

export const deleteFreedomWallItemService = async({itemId, userId}) => {
    if(!userId){
        throw {status: 401, error: "not authorized"};
    }

    if(!itemId){
        throw {status: 400, error: "itemId is required"};
    }

    const {data: existingItem, error: existingItemError} = await supabase
        .from("freedom_wall_items")
        .select("id, week_id, user_id")
        .eq("id", itemId)
        .is("deleted_at", null)
        .maybeSingle();

    if(existingItemError){
        console.error("supabase error while reading freedom wall item:", existingItemError.message);
        throw {status: 500, error: "failed to read freedom wall item"};
    }

    if(!existingItem?.id){
        throw {status: 404, error: "freedom wall item not found"};
    }

    if(String(existingItem.user_id) !== String(userId)){
        throw {status: 403, error: "not allowed to delete this freedom wall item"};
    }

    await assertActiveWeek(existingItem.week_id);

    const {error: deleteError} = await supabase
        .from("freedom_wall_items")
        .update({
            deleted_at: new Date().toISOString()
        })
        .eq("id", itemId);

    if(deleteError){
        console.error("supabase error while deleting freedom wall item:", deleteError.message);
        throw {status: 500, error: "failed to delete freedom wall item"};
    }

    return {message: "deleted", itemId: itemId};
};

export const getFreedomWallStickersService = async() => {
    const {data: stickers, error: stickersError} = await supabase
        .from("freedom_wall_stickers")
        .select("id, name, asset_url, is_active, created_at")
        .eq("is_active", true)
        .order("name", {ascending: true});

    if(stickersError){
        console.error("supabase error while reading freedom wall stickers:", stickersError.message);
        throw {status: 500, error: "failed to fetch freedom wall stickers"};
    }

    return {stickers: stickers || []};
};
