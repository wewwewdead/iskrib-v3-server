import supabase from "./supabase.js"
export const checkUserService = async(userId) =>{
    if(!userId){
        throw {status: 400, error: 'userId is undefined'}
    }
    const {data: userData, error: errorFetching} = await supabase
    .from('users')
    .select('id')
    .eq('id', userId)

    if(errorFetching){
        console.error('supabase error:', errorFetching.message)
        throw {status: 500, error: 'supabase error while checking user data'}
    }

    return userData;

}
