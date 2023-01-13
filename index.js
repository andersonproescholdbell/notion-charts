const QuickChart = require('quickchart-js');
const dotenv = require('dotenv');
const { Client } = require('@notionhq/client');
dotenv.config();

const notion = new Client({ auth: process.env.NOTION_API_KEY });
const databaseId = process.env.NOTION_DATABASE_ID;
const pageId = process.env.NOTION_PAGE_ID;
const numDays = 14;

const queryDatabase = async (databaseId, f) => {
    try {
        const response = await notion.databases.query({
            database_id: databaseId,
            filter: f
        });  
        return response.results;
    } catch (error){
        console.log(error.body);
    }
}

const getChildBlocks = async (pageId) => {
    try {
        const response = await notion.blocks.children.list({
            block_id: pageId,
            page_size: 50,
          });
        return response.results;
    } catch (error){
        console.log(error.body);
    }
}

const getData = async () => {
    const filter = { 
        property: "Status",
        select : {
            does_not_equal: "Done"
        }
    };

    return await queryDatabase(databaseId, filter);
}

const calcWork = (data, cats) => {
    // place to store hours of work for the next numDays days
    let arrs = [];
    
    for (var i = 0; i < Object.keys(cats).length; i++) {
        arrs.push(Array(numDays).fill(0));
    }

    // add: if no start just use date.now()
    for (var i of data) {
        // change these conditions eventually
        if (i.properties.Start.date) {
            let now = Math.floor(Date.now() / 1000);
            let start = Math.floor((new Date(i.properties.Start.date.start)).valueOf() / 1000);
            // if there is no finish date, finish is assigned to the start day
            let finish = (i.properties.Finish.date) ? Math.floor((new Date(i.properties.Finish.date.start)).valueOf() / 1000) : now;

            // if start was before now
            if (now >= start) start = now;
            // if finish was before now
            if (now >= finish) finish = now;

            let days = Math.ceil( (finish - start) / (86400) ) + 1;
            let hoursPerDay = Math.round( (i.properties.Hours.number / days) * 100 ) / 100;

            let firstDay = Math.ceil( (start - now) / 86400);

            for (var x = firstDay; x < firstDay+days && x < numDays; x++) {
                // anything without a category gets put into "Other"
                arrs[(i.properties.Category.select) ? cats[i.properties.Category.select.name].order : cats['Other'].order][x] += hoursPerDay;
            }
        }
    }

    return arrs;
}

const makeLabel = () => {
    const w = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
    let d = (new Date()).getDay();

    let arr = ['Tdy', 'Tmw', w[(d+2)%7], w[(d+3)%7], w[(d+4)%7], w[(d+5)%7], w[(d+6)%7], w[(d+7)%7],
               w[(d+8)%7], w[(d+9)%7], w[(d+10)%7], w[(d+11)%7], w[(d+12)%7], w[(d+13)%7]]

    return arr;
}

const createChart = (sets) => {
    const myChart = new QuickChart();
    myChart.setConfig({
        type: 'bar',
        data: { 
            labels: makeLabel(), 
            datasets: sets
        },
        options: {
            legend: {
                display: false
            },
            scales: {
                xAxes: [
                    {   
                        gridLines: {
                            color: 'rgba(0, 0, 0, 0.7)'
                        },
                        ticks: {
                            minRotation: 0,
                            maxRotation: 45,
                            padding: 0,
                            labelOffset: 0
                        },
                        stacked: true
                    },
                ],
                yAxes: [
                    {
                        gridLines: {
                            color: 'rgba(0, 0, 0, 0.7)'
                        },
                        ticks: {
                            min: 0,
                            max: 8
                        },
                        stacked: true
                    }
                ]
            },
            plugins: {
              roundedBars: true 
            }
        }
    })
    .setWidth(500)
    .setHeight(150)
    .setBackgroundColor('transparent');

    return myChart.getUrl();
}

const getBlock = async (pageId) => {
    const blocks = await getChildBlocks(pageId);
    
    for (var b of blocks) {
        if (b.type == 'embed') {
            return {id: b.id, url: b.embed.url};
        }
    }
}

const replaceChart = async (id, url) => {  
    return await notion.blocks.update({
        block_id: id,
        embed : {
            url: url
        }
    });
}

const getCategories = async () => {
    const res = await notion.databases.retrieve({
        database_id: databaseId
    }); 

    let cats = {};
    let catArr = [];

    for (var x of res.properties.Category.select.options) {
        cats[x.name] = { color: (x.color == 'default') ? 'gray' : x.color, order: Object.keys(cats).length };
        catArr.push(cats[x.name]);
    }
    
    return { cats: cats, catArr: catArr };
}

const createDataSets = (arrs, cats) => {
    let datasets = [];

    for (var i = 0; i < arrs.length; i++) {
        datasets.push(
            {
                data: arrs[i],
                backgroundColor: cats[i].color
            }
        );
    }

    return datasets;
}

// can currently only handle there being under 100 items --> look into pagination to fix
exports.handler = async (event) => {
    const data = await getData();
    const cats = await getCategories(data);
    const arrs = calcWork(data, cats.cats);
    const dataSets = createDataSets(arrs, cats.catArr);
    const chartUrl = createChart(dataSets);
    const block = await getBlock(pageId);

    if (block.url != chartUrl) {
        await replaceChart(block.id, chartUrl);
        return 'Replaced';
    } else {
        return 'No replacement'
    }
}

// uncomment this to run locally
// exports.handler();

// https://www.youtube.com/watch?v=aDqxCYRDQNI
// https://www.youtube.com/watch?v=RfbUOglbuLc

// zip -r9q deploy.zip .
// then upload as zip to aws lambda