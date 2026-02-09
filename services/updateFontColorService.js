import supabase from "./supabase.js"

export const updateFontColorService = async(fontColor, userId) =>{
    if(!userId){
        console.error('userId is undefined');
        throw {status: 400, error: 'userId is undefined'};
    }

    if(!fontColor){
        console.error('missing font color!')
        throw {status: 400, error: 'missing font color'}
    }

    const {data: updateFont, error: errorUpdateFont} = await supabase
    .from('users')
    .update({profile_font_color: fontColor})
    .eq('id', userId);

    if(errorUpdateFont){
        console.error('supabase error:', errorUpdateFont.message);
        throw {status: 500, error: 'error updating fontcolor'};
    }

    return true;
}
