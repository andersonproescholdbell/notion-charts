const QuickChart = require('quickchart-js');
const dotenv = require('dotenv');
const { Client } = require('@notionhq/client');
dotenv.config();

const notion = new Client({ auth: process.env.NOTION_API_KEY });
const databaseId = process.env.NOTION_DATABASE_ID;
const pageId = process.env.NOTION_PAGE_ID;
const numDays = 15;
const order = ['Probability', 'STS', 'Databases', 'Data Analysis', 'Other'];

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

const getData = async () => {
    const filter = {
        and: [
            { 
                property: "Completed",
                checkbox: {
                    equals: false
                }
            },
            {
                property: "Hours",
                number: {
                    greater_than: 0
                }
            }
        ]
    };

    return await queryDatabase(databaseId, filter);
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

const getDay = (d) => {
    d.setUTCHours(d.getUTCHours() - 5);
    d.setUTCHours(0, 0, 0, 0);
    return d;
}

const calcWork = (data, cats) => {
    // place to store hours of work for the next numDays days
    let arrs = [];
    let total = Array(numDays).fill(0);
    
    for (var i = 0; i < Object.keys(cats).length; i++) {
        arrs.push(Array(numDays).fill(0));
    }

    let today = getDay(new Date());

    // our data filter means we only get data where hours is filled out
    for (var i of data) {
        // if there is no start date, start is assigned to today
        let start = (i.properties.Start.date) ? new Date(i.properties.Start.date.start) : today;
        // if there is no finish date, finish is assigned to the start day
        let finish = (i.properties.Finish.date) ? new Date(i.properties.Finish.date.start) : start;
    
        // if start was before today make it today
        if (today >= start) start = today;
        // if finish was before today make it today
        if (today >= finish) finish = today;
        
        let firstDay = Math.round( (start - today) / 86400000);
        let days = Math.round( (finish - start) / 86400000 ) + 1;
        let hoursPerDay = Math.round( (i.properties.Hours.number / days) * 100 ) / 100;
        
        for (var x = firstDay; x < firstDay+days && x < numDays; x++) {
            // anything without a category gets put into "Other"
            arrs[(i.properties.Category.select) ? cats[i.properties.Category.select.name].order : cats['Other'].order][x] += hoursPerDay;
            total[x] += hoursPerDay;
        }
    }

    return { arrs: arrs, max: Math.max(...total) };
}

const getMonthDay = (day) => {
    let m = day.getMonth() + 1;
    let d = day.getDate();
    return m + "/" + d;
}

const makeLabel = () => {
    const w = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
    let arr = [];

    let day = (getDay(new Date()));
    arr.push('Tdy\n' + getMonthDay(day));
    day.setDate(day.getDate() + 1);
    arr.push('Tmw\n' + getMonthDay(day))
    for (var i = 0; i < numDays-2; i++) {
        day.setDate(day.getDate() + 1);
        arr.push(w[day.getDay()] + '\n' + getMonthDay(day));
    }

    return arr;
}

const createChart = (sets, m) => {
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
            layout: {
                padding: {
                    bottom: 6
                }
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
                            max: m,
                            stepSize: 1
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
    .setWidth(600)
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

function toHex(color) {
    var colors = {
        "blue":"#28456c", 
        "default":"#373737",
        "green":"#2b593f",
        "purple":"#492f64",
        "red":"#6e3630"
    };

    return colors[color];
}

const getCategories = async () => {
    const res = await notion.databases.retrieve({
        database_id: databaseId
    }); 

    let temp = [];
    for (var x of res.properties.Category.select.options) {
        temp.push(x.name);
    }

    let catArr = [];
    let cats = {};
    // if our predefined order has the exact same categories as our data
    if ([...order].sort().join('') == temp.sort().join('')) {
        for (var i of [...Array(5).keys()]) {
            for (var x of res.properties.Category.select.options) {
                if (x.name == order[i]) {
                    cats[x.name] = { color: toHex(x.color), order: Object.keys(cats).length, a: x.name };
                    catArr.push(cats[x.name]);
                }
            }
        }
    } else {
        for (var x of res.properties.Category.select.options) {
            cats[x.name] = { color: toHex(x.color), order: Object.keys(cats).length };
            catArr.push(cats[x.name]);
        }
    }

    console.log(catArr);
    
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
    const work = calcWork(data, cats.cats);
    const dataSets = createDataSets(work.arrs, cats.catArr);
    const chartUrl = createChart(dataSets, Math.max(Math.ceil(work.max/4)*4, 4));
    const block = await getBlock(pageId);

    if (block.url != chartUrl) {
        await replaceChart(block.id, chartUrl);
        return 'Replaced';
    } else {
        return 'No replacement'
    }
}

// uncomment this to run locally
exports.handler();
