const QuickChart = require('quickchart-js');
const dotenv = require('dotenv');
const { Client } = require('@notionhq/client');
dotenv.config();

const notion = new Client({ auth: process.env.NOTION_API_KEY });
const databaseId = process.env.NOTION_DATABASE_ID;
const pageId = process.env.NOTION_PAGE_ID;
const numDays = 30;
const avgDays = 7;
const chartHeight = 160;
const chartWidth = 1000;

const queryDatabase = async (databaseId, f) => {
    try {
        var response = await notion.databases.query({
            database_id: databaseId,
            ...(f && { filter: f })
        });

        var all = response.results;

        while (response['has_more']) {
            response = await notion.databases.query({
                database_id: databaseId,
                start_cursor: response['next_cursor'],
                ...(f && { filter: f })
            });
            all = all.concat(response.results);
        }

        console.log(all.length)
        return all;
    } catch (error) {
        console.log(error.body);
    }
}

const getData = async () => {
    const filter = {
        and: [
            {
                property: 'Completed',
                date: {
                    is_empty: true,
                },
            },
            {
                property: 'Hours',
                number: {
                    greater_than: 0,
                },
            },
        ],
    }

    return await queryDatabase(databaseId, filter);
}

const getChildBlocks = async (pageId) => {
    try {
        const response = await notion.blocks.children.list({
            block_id: pageId,
            page_size: 50,
        });
        return response.results;
    } catch (error) {
        console.log(error.body);
    }
}


const getDays = (now_utc_timestamp, date_string) => {
    // A date_string from Notion (e.g., '2025-09-05') is parsed by new Date() as midnight UTC.
    const taskDate = new Date(date_string);
    const diff = taskDate.getTime() - now_utc_timestamp;
    const days = diff < 0 ? 0 : Math.round(diff / (1000 * 60 * 60 * 24));

    return days;
}

const calcWork = (data, cats) => {
    // place to store hours of work for the next numDays days
    let arrs = [], total = Array(numDays).fill(0), totalHours = 0;

    for (var i = 0; i < Object.keys(cats).length; i++) {
        arrs.push(Array(numDays).fill(0));
    }

    let now = new Date();
    now.setUTCHours(0, 0, 0, 0); // Set to midnight UTC for consistent comparison
    now = now.getTime();


    // Process all tasks from database
    for (var i of data) {

        let dateString = (i.properties.Start && i.properties.Start.date) ? i.properties.Start.date.start : null;

        let days = dateString ? getDays(now, dateString) : 0;

        if (days < numDays) {
            let hours = i.properties.Hours.number;

            total[days] += hours;
            if (days < avgDays) totalHours += hours;

            let category = i.properties.Category.select;

            // anything without a category gets put into "Other"
            arrs[category ? cats[category.name].order : cats['Other'].order][days] += hours;
        }
    }

    return { arrs: arrs, max: Math.max(...total), totalHours: totalHours };
}

const getMonthDay = (day) => {
    let m = day.getUTCMonth() + 1;
    let d = day.getUTCDate();
    return m + "/" + d;
}

const makeLabel = () => {
    const w = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
    let arr = [];

    let day = new Date();
    day.setUTCHours(0, 0, 0, 0); // Set to midnight UTC for consistency

    arr.push('Tdy\n' + getMonthDay(day));
    day.setUTCDate(day.getUTCDate() + 1);
    arr.push('Tmw\n' + getMonthDay(day));

    for (var i = 0; i < numDays - 2; i++) {
        day.setUTCDate(day.getUTCDate() + 1);
        arr.push(w[day.getUTCDay()] + '\n' + getMonthDay(day));
    }

    return arr;
}

const createChart = (sets, maxHours, totalHours) => {
    const m = Math.max(Math.ceil(maxHours / 4) * 4, 8);
    const h = +(Math.round(totalHours / avgDays + "e+2") + "e-2");
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
            title: {
                display: true,
                text: `${h} hours / day, next ${avgDays} days`,
                position: 'top',
                fontStyle: 'normal',
                padding: 2,
                fontSize: 10
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
                            stepSize: 2
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
        .setWidth(chartWidth)
        .setHeight(chartHeight)
        .setBackgroundColor('transparent');

    return myChart.getUrl();
}

const getBlock = async (pageId) => {
    const blocks = await getChildBlocks(pageId);

    for (var b of blocks) {
        if (b.type == 'embed') {
            return { id: b.id, url: b.embed.url };
        }
    }
}

const replaceChart = async (id, url) => {
    return await notion.blocks.update({
        block_id: id,
        embed: {
            url: url
        }
    });
}

function toHex(color) {
    var colors = {
        "default": "#373737",
        "gray": "#5a5a5a",
        "brown": "#603b2c",
        "orange": "#854c1d",
        "yellow": "#89632a",
        "green": "#2b593f",
        "blue": "#28456c",
        "purple": "#492f64",
        "pink": "#69314c",
        "red": "#6e3630"
    };

    return colors[color];
}

const getCategories = async () => {
    const res = await notion.databases.retrieve({
        database_id: databaseId
    });

    let catArr = [];
    let cats = {};
    for (var x of res.properties.Category.select.options) {
        cats[x.name] = { color: toHex(x.color), order: Object.keys(cats).length };
        catArr.push(cats[x.name]);
    }

    // add other category
    cats["Other"] = { color: toHex("default"), order: Object.keys(cats).length };
    catArr.push(cats["Other"]);

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

exports.handler = async (event) => {
    const data = await getData();
    const cats = await getCategories(data);
    const work = calcWork(data, cats.cats);
    const dataSets = createDataSets(work.arrs, cats.catArr);
    const chartUrl = createChart(dataSets, work.max, work.totalHours);
    console.log(chartUrl);
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