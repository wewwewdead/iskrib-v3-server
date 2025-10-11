import express from "express";
import cors from 'cors';
import router from "./routes/routes.js";

const app = express();
const PORT = process.env.PORT || 3000;

app.use(cors({
    origin: ['http://localhost:5173'],
    methods: 'GET,POST,PUT,DELETE',
    credentials: true
}))

app.use(express.json());
app.use(express.urlencoded({extended: true}));

app.use(router)

app.get('/', (req, res) => {
    res.send(`hello from backend port ${PORT}`)
})
app.listen(PORT, () =>{
    console.log(`server is running at port${PORT}`)
})