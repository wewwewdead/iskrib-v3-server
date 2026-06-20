
export const verifyTurnstileService = async(token) =>{
    if(!token) {
        const err = new Error('No token provided');
        err.status = 400;
        throw err;
    }

    const secretKey = process.env.SECRET_KEY;

    const response = await fetch('https://challenges.cloudflare.com/turnstile/v0/siteverify',{
            method: 'POST',
            headers: {"Content-Type": "application/x-www-form-urlencoded" },
            body: new URLSearchParams({
                secret: secretKey,
                response: token,
            })
        })

        const data = await response.json();

        if(!data.success){
            const err = new Error('Turnstile verification failed');
            err.status = 400;
            err.cloudflareErrors = data['error-codes'] || [];
            throw err;
        }

        return true;
}