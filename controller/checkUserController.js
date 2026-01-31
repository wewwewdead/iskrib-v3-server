import { checkUserService } from "../services/checkUserService.js";

export const checkUserController = async (req, res) =>{
    const {userId} = req.query;
     try {
        const data = await checkUserService(userId);
        return res.status(200).json({exist: data.length > 0})
     } catch (error) {
        console.error(error);
        return res.status(500).json({error: 'supabase error while checking user data'})
     }
}