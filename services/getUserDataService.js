import supabase from "./supabase.js"

export const getUserByUsernameService = async(username) => {
    if(!username || typeof username !== 'string'){
        throw {status: 400, message: 'username is required'};
    }

    const normalizedUsername = username.trim().toLowerCase();

    const { data: users, error: userError } = await supabase
        .from('users')
        .select('*')
        .ilike('username', normalizedUsername)
        .limit(1);

    if(userError){
        console.error('supabase error fetching user by username:', userError.message);
        throw {status: 500, message: 'supabase error fetching user by username'};
    }

    if(!users || users.length === 0){
        throw {status: 404, message: 'user not found'};
    }

    const user = users[0];

    const followerCountPromise = supabase
        .from('follows')
        .select('*', {count: 'exact', head: true})
        .eq('following_id', user.id);

    const followingCountPromise = supabase
        .from('follows')
        .select('*', {count: 'exact', head: true})
        .eq('follower_id', user.id);

    const [followerCountResult, followingCountResult] = await Promise.all([
        followerCountPromise, followingCountPromise
    ]);

    const {count: followerCount, error: errorFollowerCount} = followerCountResult;
    const {count: followingCount, error: errorFollowingCount} = followingCountResult;

    if(errorFollowerCount || errorFollowingCount){
        console.error('supabase error fetching follow counts:', errorFollowerCount || errorFollowingCount);
    }

    return {
        userData: [user],
        followerCount: followerCount || 0,
        followingCount: followingCount || 0
    };
}

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