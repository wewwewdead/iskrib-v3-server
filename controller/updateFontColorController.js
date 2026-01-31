import { updateFontColorService } from "../services/updateFontColorService.js";

export const updateFont = async(req, res)=>{
    const {fontColor} = req.body;

    const token = req.headers.authorization?.split(' ')[1];

    try {
        await updateFontColorService(fontColor, token)
        return res.status(200).json({message: 'success'})
    } catch (error) {
        console.error(error)
        return res.status(500).json({error: 'error updating font color'})
    }
}