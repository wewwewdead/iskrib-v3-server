import { checkUserService } from "../services/checkUserService.js";

export const checkUserController = async (req, res) =>{
    const {userId} = req.query;
     try {
        const data = await checkUserService(userId);
        const exist = data.length > 0;
        const onboardingCompleted = exist ? (data[0].onboarding_completed ?? true) : false;
        return res.status(200).json({exist, onboardingCompleted})
     } catch (error) {
        console.error(error);
        return res.status(500).json({error: 'supabase error while checking user data'})
     }
}