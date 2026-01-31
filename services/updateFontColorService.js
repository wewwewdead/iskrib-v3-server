import supabase from "./supabase.js"

export const updateFontColorService = async(fontColor, token) =>{
    if(!token){
        console.error('token is undefined');
        throw {status: 400, error: 'token is undefined'};
    }

    if(!fontColor){
        console.error('missing font color!')
        throw {status: 400, error: 'missing font color'}
    }

    const {data: authData, error: errorAuthData} = await supabase.auth.getUser(token);

    if(errorAuthData){
        console.error('supabase error:', errorAuthData.message);
        throw {status: 500, error:'supabase error while validating user'}
    }

    const userId = authData?.user.id;
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