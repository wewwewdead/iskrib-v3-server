const ParseContent = (contentString) => {

    //sample json data to be passed here..

    // {'root': {
    //     'children': [
    //         {
    //             type: 'paragraph', 
    //             "children": [
    //                 {
    //                     'type': 'text',
    //                     'text': 'some text'
    //                 },
    //                 {
    //                     'type': 'image',
    //                     'src': "https://hufaxmqdofaycnhdzrxf.supabase.co/...webp",
    //                     'width': 500,
    //                     'height': 500
    //                 }
    //             ]
    //         },
    //     ]
    // }}


    try {
        const content = JSON.parse(contentString);
        const root = content.root;
        const children = root?.children || [];
            
        const parsedData = {
            text: [],
            slicedText: [],
            images: [],
            firstImage: null,
            wholeText: null,
        };
        const extractFromNodes = (nodes) =>{
            nodes.forEach((node) => {
                if(node.type === 'paragraph' || node.type === 'heading'){
                    //extract text
                    const textNodes = node.children?.filter((child) => child.type === "text") || [];
                    const paragraphText = textNodes.map((child) => child.text).join(" "); //join all the array of text into one text form

                    if(paragraphText.trim()) parsedData.text.push(paragraphText);

                    const imageNodes = node.children?.filter((child) => child.type === 'image') || [];

                    imageNodes.forEach((img) => {
                        const imageData = {src: img.src, width: img.width, height: img.height};
                        parsedData.images.push(imageData)
                        if(!parsedData.firstImage) parsedData.firstImage = imageData;
                    })
                }

                if (node.type === "image") {
                    const imageData = { src: node.src, width: node.width, height: node.height };
                    parsedData.images.push(imageData);
                    if (!parsedData.firstImage) parsedData.firstImage = imageData;
                 }

                if(node.children) extractFromNodes(node.children);
            });
        }

        extractFromNodes(children);

        const combinedText = parsedData.text.join(' ').trim();
        parsedData.wholeText = combinedText;
        parsedData.slicedText = combinedText.length > 215 ? `${combinedText.substring(0, 215)}...` : combinedText;
        
        return parsedData; //return the parsedData
        } catch (error) {
            console.error('Error parsing content:', error);
            return { text: [], images: [] };
        }
}
export default ParseContent;

