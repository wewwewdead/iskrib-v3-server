import supabase from "./supabase.js"

export const getUserDataService = async(userId) =>{
    if(!userId){
        throw {status: 400, message: 'userid is undefined'}
    }
    const userDataPromise = supabase
    .from('users')
    .select('*')
    .eq('id', userId)

    const followerCountPromise = supabase
    .from('follows')
    .select('*', {count: 'exact', head: true})
    .eq('following_id', userId)

    const followingCountPromise = supabase
    .from('follows')
    .select('*', {count: 'exact', head: true})
    .eq('follower_id', userId)

    const [userDataResult, followerCountResult, followingCountResult] = await Promise.all([
        userDataPromise, followerCountPromise, followingCountPromise
    ])

    const {data: userData, error: errorUserData} = userDataResult;
    const {count: followerCount, error: errorFollowerCount} = followerCountResult;
    const {count: followingCount, error: errorFollowingCount} = followingCountResult;

    if(errorUserData || errorFollowerCount || errorFollowingCount){
        console.error('supabase error while fetching user data:', errorUserData || errorFollowerCount || errorFollowingCount)
        throw {status: 400, message: 'supabase error while fetching user data'}
    }
    const data = {userData: userData, followerCount: followerCount, followingCount: followingCount}
    return data;
}