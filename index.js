const QuickChart = require('quickchart-js');
const dotenv = require('dotenv');
const { Client } = require('@notionhq/client');
dotenv.config();

const notion = new Client({ auth: process.env.NOTION_API_KEY });
const databaseId = process.env.NOTION_DATABASE_ID;
const pageId = process.env.NOTION_PAGE_ID;
const numDays = 22;
const avgDays = 7;
const chartHeight = 160;
const chartWidth = 900;

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
                property: 'Points',
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


const getDays = (now_eastern_timestamp, date_string) => {
    // Notion date strings are 'YYYY-MM-DD'. new Date() parses this as midnight UTC.
    const taskDate = new Date(date_string);

    const diff = taskDate.getTime() - now_eastern_timestamp;
    // Use Math.floor to ensure we get the number of full days.
    const days = Math.floor(diff / (1000 * 60 * 60 * 24)) + 1;

    return days < 0 ? 0 : days;
}

const calcWork = (data, cats) => {
    // place to store hours of work for the next numDays days
    let arrs = [], total = Array(numDays).fill(0), totalHours = 0, totalPoints30Days = 0;

    for (var i = 0; i < Object.keys(cats).length; i++) {
        arrs.push(Array(numDays).fill(0));
    }

    // Create a date string for the current date in the target timezone, e.g., "9/5/2025"
    const easternDateString = new Date().toLocaleDateString('en-US', {
        timeZone: 'America/New_York',
    });
    // Create a new Date object representing midnight at the start of that day.
    let now = new Date(easternDateString).getTime();

    // Array to collect task info for sorted logging
    let tasksForLogging = [];

    // Process all tasks from database
    for (var [index, i] of data.entries()) {
        // Log full properties for first task only
        // if (index === 0) {
        //     console.log('=== FIRST TASK FULL PROPERTIES ===');
        //     console.log('Available properties:', Object.keys(i.properties));
        //     console.log('Full task structure:', JSON.stringify(i.properties, null, 2));
        //     console.log('================================');
        // }

        let dateString = (i.properties.Date && i.properties.Date.date) ? i.properties.Date.date.start : null;

        let days = dateString ? getDays(now, dateString) : 0;

        if (days < numDays) {
            let points = i.properties.Points.number;
            let taskName = i.properties.Name?.title?.[0]?.plain_text || 'Untitled Task';

            // Collect task info for sorted logging
            tasksForLogging.push({
                name: taskName,
                points: points,
                days: days,
                dateString: dateString
            });

            total[days] += points;
            if (days < avgDays) totalHours += points;
            totalPoints30Days += points; // Add to 30-day total

            let category = i.properties.Category.select;

            // anything without a category gets put into "Other"
            arrs[category ? cats[category.name].order : cats['Other'].order][days] += points;
        }
    }

    // Sort tasks by days (soonest to latest) and log them
    tasksForLogging.sort((a, b) => a.days - b.days);
    console.log('\n=== TASKS SORTED BY DATE (SOONEST TO LATEST) ===');
    for (let task of tasksForLogging) {
        console.log(`Task: "${task.name}" - ${task.points} hours assigned to day ${task.days} (${task.dateString || 'no date'})`);
    }
    console.log('===============================================\n');

    console.log('Final total array distribution:', total);

    // Log current time to confirm timezone is correct
    const currentTime = new Date();
    const easternTime = new Date(currentTime.toLocaleString("en-US", { timeZone: "America/New_York" }));
    console.log('\n=== TIMEZONE VERIFICATION ===');
    console.log('Current time (system):', currentTime.toString());
    console.log('Current time (Eastern):', easternTime.toString());
    console.log('Midnight Eastern timestamp used for calculations:', new Date(now).toString());
    console.log('============================\n');

    return { arrs: arrs, max: Math.max(...total), totalHours: totalHours, totalPoints30Days: totalPoints30Days };
}

const getMonthDay = (day) => {
    let m = day.getMonth() + 1;
    let d = day.getDate();
    return m + "/" + d;
}

const makeLabel = () => {
    const w = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
    let arr = [];

    // Create a date string for the current date in the target timezone, e.g., "9/5/2025"
    const easternDateString = new Date().toLocaleDateString('en-US', {
        timeZone: 'America/New_York',
    });
    // Create a new Date object representing midnight at the start of that day.
    let day = new Date(easternDateString);

    arr.push('Tdy\n' + getMonthDay(day));
    day.setDate(day.getDate() + 1);
    arr.push('Tmw\n' + getMonthDay(day));

    for (var i = 0; i < numDays - 2; i++) {
        day.setDate(day.getDate() + 1);
        arr.push(w[day.getDay()] + '\n' + getMonthDay(day));
    }

    return arr;
}

const createChart = (sets, maxHours, totalHours, totalPoints30Days) => {
    const m = Math.max(Math.ceil(maxHours / 4) * 4, 8);
    const h = Math.round(totalHours / avgDays, 2);
    const h2 = Math.round(totalPoints30Days, 2);
    const totalDays = numDays; // 30 days
    const myChart = new QuickChart();
    myChart.setConfig({
        version: '2.9.4',
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
                text: `${h} points / day, next ${avgDays} days || ${h2} points total, next ${totalDays} days`,
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
                            color: 'rgba(0, 0, 0, 0.7)',
                            drawOnChartArea: false
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
    const chartUrl = createChart(dataSets, work.max, work.totalHours, work.totalPoints30Days);
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
// BEFORE DEPLOYING MAKE SURE TO COMMENT THIS OUT
exports.handler();