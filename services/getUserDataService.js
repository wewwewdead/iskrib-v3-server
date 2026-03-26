import supabase from "./supabase.js"
import { createMediaResponsePayload } from "../utils/mediaVariants.js";

const USER_PROFILE_SELECT = `
    id, name, bio, image_url, badge, username,
    background, profile_font_color, dominant_colors, secondary_colors,
    writing_interests, writing_goal,
    onboarding_completed, onboarding_completed_at,
    created_at
`;

const decorateProfileUser = (user) => {
    if(!user){
        return user;
    }

    const avatarMedia = createMediaResponsePayload('avatars', user.image_url, 'detail');
    return {
        ...user,
        image_url: avatarMedia?.preferred_url || user.image_url || null,
        avatar_media: avatarMedia
    };
};

export const getUserByUsernameService = async(username) => {
    if(!username || typeof username !== 'string'){
        throw {status: 400, message: 'username is required'};
    }

    const normalizedUsername = username.trim().toLowerCase();

    const { data: users, error: userError } = await supabase
        .from('users')
        .select(USER_PROFILE_SELECT)
        .ilike('username', normalizedUsername)
        .limit(1);

    if(userError){
        console.error('supabase error fetching user by username:', userError.message);
        throw {status: 500, message: 'supabase error fetching user by username'};
    }

    if(!users || users.length === 0){
        throw {status: 404, message: 'user not found'};
    }

    const user = decorateProfileUser(users[0]);

    const followerCountPromise = supabase
        .from('follows')
        .select('id', {count: 'exact', head: true})
        .eq('following_id', user.id);

    const followingCountPromise = supabase
        .from('follows')
        .select('id', {count: 'exact', head: true})
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
    .select(USER_PROFILE_SELECT)
    .eq('id', userId)

    const followerCountPromise = supabase
    .from('follows')
    .select('id', {count: 'exact', head: true})
    .eq('following_id', userId)

    const followingCountPromise = supabase
    .from('follows')
    .select('id', {count: 'exact', head: true})
    .eq('follower_id', userId)

    const postsCountPromise = supabase
    .from('journals')
    .select('id', {count: 'exact', head: true})
    .eq('user_id', userId)
    .eq('privacy', 'public')

    const [userDataResult, followerCountResult, followingCountResult, postsCountResult] = await Promise.all([
        userDataPromise, followerCountPromise, followingCountPromise, postsCountPromise
    ])

    const {data: userData, error: errorUserData} = userDataResult;
    const {count: followerCount, error: errorFollowerCount} = followerCountResult;
    const {count: followingCount, error: errorFollowingCount} = followingCountResult;
    const {count: postsCount, error: errorPostsCount} = postsCountResult;

    if(errorUserData || errorFollowerCount || errorFollowingCount || errorPostsCount){
        console.error('supabase error while fetching user data:', errorUserData || errorFollowerCount || errorFollowingCount || errorPostsCount)
        throw {status: 400, message: 'supabase error while fetching user data'}
    }
    const data = {
        userData: Array.isArray(userData) ? userData.map((user) => decorateProfileUser(user)) : userData,
        followerCount: followerCount,
        followingCount: followingCount,
        postsCount: postsCount
    }
    return data;
}
